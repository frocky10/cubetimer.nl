<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Taal.php';
require_once __DIR__ . '/Xp.php';

/**
 * Volgen en vrienden.
 *
 * Volgen is eenzijdig: je hebt geen toestemming nodig, net als op Twitter.
 * Volgen jullie elkaar allebei, dan heet dat vanzelf vrienden. Er zijn dus
 * geen verzoeken om goed te keuren.
 *
 * Je kunt alleen iemand volgen die meedoet aan de ranglijsten. Wie zichzelf
 * daarvan afhaalt, is voor niemand te vinden en dus ook niet te volgen.
 */
final class Follows
{
    /** Hoeveel mensen je hooguit kunt volgen. Houdt de vriendenranglijst werkbaar. */
    private const MAX_FOLLOWING = 500;

    /** @return array{following:bool,followsYou:bool,friends:bool} */
    public static function relation(?int $viewerId, int $targetId): array
    {
        if ($viewerId === null || $viewerId === $targetId) {
            return ['following' => false, 'followsYou' => false, 'friends' => false];
        }

        $rows = Database::all(
            'SELECT follower_id, following_id FROM user_follows
             WHERE (follower_id = ? AND following_id = ?)
                OR (follower_id = ? AND following_id = ?)',
            [$viewerId, $targetId, $targetId, $viewerId]
        );

        $volgt = false;
        $wordtGevolgd = false;
        foreach ($rows as $row) {
            if ((int) $row['follower_id'] === $viewerId) {
                $volgt = true;
            } else {
                $wordtGevolgd = true;
            }
        }

        return [
            'following'  => $volgt,
            'followsYou' => $wordtGevolgd,
            'friends'    => $volgt && $wordtGevolgd,
        ];
    }

    /**
     * @return array{ok:bool,message:string,relation?:array<string,mixed>}
     */
    public static function follow(int $viewerId, int $targetId): array
    {
        if ($viewerId === $targetId) {
            return ['ok' => false, 'message' => 'Jezelf volgen heeft weinig zin.'];
        }

        $doel = Database::first(
            'SELECT u.id FROM users u
             JOIN user_profiles p ON p.user_id = u.id
             WHERE u.id = ? AND u.is_active = 1 AND p.show_on_leaderboard = 1',
            [$targetId]
        );
        if ($doel === null) {
            return ['ok' => false, 'message' => 'Deze cuber bestaat niet, of deelt dit profiel niet.'];
        }

        if (self::countFollowing($viewerId) >= self::MAX_FOLLOWING) {
            return ['ok' => false, 'message' => Taal::t('Je volgt al het maximale aantal cubers ({n}).', ['n' => self::MAX_FOLLOWING])];
        }

        try {
            Database::run(
                'INSERT IGNORE INTO user_follows (follower_id, following_id) VALUES (?, ?)',
                [$viewerId, $targetId]
            );
        } catch (PDOException $e) {
            error_log('[cubetimer] volgen mislukt: ' . $e->getMessage());
            return ['ok' => false, 'message' => 'Dat is niet gelukt.'];
        }

        $relatie = self::relation($viewerId, $targetId);
        return [
            'ok' => true,
            'message' => $relatie['friends'] ? 'Jullie zijn nu vrienden.' : 'Je volgt deze cuber.',
            'relation' => $relatie,
        ];
    }

    /** @return array{ok:bool,message:string,relation?:array<string,mixed>} */
    public static function unfollow(int $viewerId, int $targetId): array
    {
        Database::run(
            'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?',
            [$viewerId, $targetId]
        );
        return [
            'ok' => true,
            'message' => 'Je volgt deze cuber niet meer.',
            'relation' => self::relation($viewerId, $targetId),
        ];
    }

    public static function countFollowing(int $userId): int
    {
        $row = Database::first('SELECT COUNT(*) AS aantal FROM user_follows WHERE follower_id = ?', [$userId]);
        return (int) ($row['aantal'] ?? 0);
    }

    public static function countFollowers(int $userId): int
    {
        $row = Database::first('SELECT COUNT(*) AS aantal FROM user_follows WHERE following_id = ?', [$userId]);
        return (int) ($row['aantal'] ?? 0);
    }

    public static function countFriends(int $userId): int
    {
        $row = Database::first(
            'SELECT COUNT(*) AS aantal
             FROM user_follows a
             JOIN user_follows b ON b.follower_id = a.following_id AND b.following_id = a.follower_id
             WHERE a.follower_id = ?',
            [$userId]
        );
        return (int) ($row['aantal'] ?? 0);
    }

    /**
     * De id's van iedereen die deze gebruiker volgt, inclusief zichzelf.
     * Zo staat de gebruiker zelf ook in zijn eigen vriendenranglijst.
     *
     * @return list<int>
     */
    public static function circleIds(int $userId): array
    {
        $rows = Database::all('SELECT following_id FROM user_follows WHERE follower_id = ?', [$userId]);
        $ids = array_map(static fn ($row): int => (int) $row['following_id'], $rows);
        $ids[] = $userId;
        return array_values(array_unique($ids));
    }

    /**
     * De lijst met gevolgde cubers of volgers, met genoeg gegevens om ze te
     * tonen.
     *
     * @param 'following'|'followers'|'friends' $soort
     * @return list<array<string,mixed>>
     */
    public static function listFor(int $userId, string $soort, int $limit = 100): array
    {
        $limit = max(1, min($limit, 200));

        $sql = match ($soort) {
            'followers' => 'SELECT u.username, p.country_code, p.level, p.xp
                            FROM user_follows f
                            JOIN users u ON u.id = f.follower_id
                            JOIN user_profiles p ON p.user_id = u.id
                            WHERE f.following_id = ? AND u.is_active = 1 AND p.show_on_leaderboard = 1',
            'friends'   => 'SELECT u.username, p.country_code, p.level, p.xp
                            FROM user_follows a
                            JOIN user_follows b ON b.follower_id = a.following_id AND b.following_id = a.follower_id
                            JOIN users u ON u.id = a.following_id
                            JOIN user_profiles p ON p.user_id = u.id
                            WHERE a.follower_id = ? AND u.is_active = 1 AND p.show_on_leaderboard = 1',
            default     => 'SELECT u.username, p.country_code, p.level, p.xp
                            FROM user_follows f
                            JOIN users u ON u.id = f.following_id
                            JOIN user_profiles p ON p.user_id = u.id
                            WHERE f.follower_id = ? AND u.is_active = 1 AND p.show_on_leaderboard = 1',
        };

        $rows = Database::all($sql . ' ORDER BY p.xp DESC LIMIT ' . $limit, [$userId]);

        return array_map(static function (array $row): array {
            $level = (int) $row['level'];
            return [
                'username' => $row['username'],
                'country'  => $row['country_code'],
                'level'    => $level,
                'tier'     => Xp::tier($level)['slug'],
            ];
        }, $rows);
    }
}
