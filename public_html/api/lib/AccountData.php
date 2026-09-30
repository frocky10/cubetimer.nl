<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Taal.php';

/**
 * Je gegevens meenemen en je account verwijderen (AVG, artikel 15, 17 en 20).
 *
 * Export: alles wat er op de server over een gebruiker staat, als één
 * JSON-bestand. Per tabel met `SELECT *`, zodat een kolom die er later bij
 * komt vanzelf meegaat. Wat nooit mee mag (hashes van wachtwoorden, tokens en
 * IP-adressen) staat in HIDDEN_COLUMNS en wordt er per rij uit gehaald. Interne
 * id's van andere gebruikers worden gebruikersnamen.
 *
 * Verwijderen: één DELETE op `users`. Bijna elke tabel heeft een foreign key
 * met ON DELETE CASCADE, dus sessies, solves, records, XP, achievements,
 * volgrelaties, toernooien, spelmodi en duels gaan mee. Wat met ON DELETE SET
 * NULL blijft staan, maken we eerst anoniem:
 *   feedback_reports        e-mailadres, IP-hash en browser eruit (de melding
 *                           zelf staat al op GitHub)
 *   tournament_competitors  je naam in andermans toernooi wordt "Oud-lid"
 *   scramble_pool           blijft; bevat alleen een scramble
 *   solve_flags.reviewed_by blijft; alleen voor beheerders
 */
final class AccountData
{
    /** Kolommen die nooit in een export komen. */
    private const HIDDEN_COLUMNS = ['password_hash', 'token_hash', 'ip_hash', 'wca_snapshot', 'ref_user_id'];

    /**
     * Tabellen met één kolom die naar de gebruiker wijst. Volgorde = volgorde in
     * het bestand. Een tabel die (nog) niet bestaat, wordt overgeslagen.
     */
    private const USER_TABLES = [
        'user_profiles'      => 'user_id',
        'timer_sessions'     => 'user_id',
        'solves'             => 'user_id',
        'user_records'       => 'user_id',
        'solve_flags'        => 'user_id',
        'xp_events'          => 'user_id',
        'challenge_entries'  => 'user_id',
        'user_achievements'  => 'user_id',
        'user_algorithms'    => 'user_id',
        'tournaments'        => 'user_id',
        'tournament_solves'  => 'user_id',
        'tournament_records' => 'user_id',
        'game_runs'          => 'user_id',
        'duel_attempts'      => 'user_id',
        'scramble_pool'      => 'submitted_by',
        'feedback_reports'   => 'user_id',
        'user_sessions'      => 'user_id',
    ];

    /** Bij je eigen toernooien, via tournament_id. */
    private const TOURNAMENT_TABLES = ['tournament_rounds', 'tournament_competitors', 'tournament_results'];

    /** @return array<string,mixed> */
    public static function export(int $userId): array
    {
        $user = Database::first('SELECT * FROM users WHERE id = ?', [$userId]);
        if ($user === null) {
            return [];
        }

        $data = [
            'uitleg' => Taal::t('Alle gegevens die CubeTimer (cubetimer.nl) over je account bewaart, op het moment van downloaden. '
                . 'Wachtwoorden, inlogsleutels en IP-adressen staan alleen als onomkeerbare hash in de database en daarom niet in dit bestand. '
                . 'Tijden staan in milliseconden; datums in UTC. Vragen: privacy@cubetimer.nl'),
            'gedownload_op' => gmdate('Y-m-d\TH:i:s\Z'),
            'account' => self::clean($user),
        ];

        foreach (self::USER_TABLES as $tabel => $kolom) {
            if (!Database::hasTable($tabel)) {
                continue;
            }
            $data[$tabel] = array_map(
                [self::class, 'clean'],
                Database::all("SELECT * FROM `$tabel` WHERE `$kolom` = ? ORDER BY 1", [$userId])
            );
        }

        if (Database::hasTable('tournaments')) {
            foreach (self::TOURNAMENT_TABLES as $tabel) {
                if (!Database::hasTable($tabel)) {
                    continue;
                }
                $data[$tabel] = array_map(
                    [self::class, 'clean'],
                    Database::all(
                        "SELECT t.* FROM `$tabel` t JOIN tournaments o ON o.id = t.tournament_id
                         WHERE o.user_id = ? ORDER BY t.tournament_id, t.id",
                        [$userId]
                    )
                );
            }
        }

        if (Database::hasTable('user_follows')) {
            $data['volgt'] = Database::all(
                'SELECT u.username, f.created_at FROM user_follows f JOIN users u ON u.id = f.following_id
                 WHERE f.follower_id = ? ORDER BY f.created_at',
                [$userId]
            );
            $data['gevolgd_door'] = Database::all(
                'SELECT u.username, f.created_at FROM user_follows f JOIN users u ON u.id = f.follower_id
                 WHERE f.following_id = ? ORDER BY f.created_at',
                [$userId]
            );
        }

        if (Database::hasTable('duels')) {
            $data['duels'] = array_map(static function (array $rij) use ($userId): array {
                $rij['tegenstander'] = (int) $rij['challenger_id'] === $userId ? $rij['opponent_name'] : $rij['challenger_name'];
                $rij['gewonnen'] = $rij['winner_id'] === null ? null : (int) $rij['winner_id'] === $userId;
                unset($rij['challenger_id'], $rij['opponent_id'], $rij['winner_id'], $rij['challenger_name'], $rij['opponent_name']);
                return self::clean($rij);
            }, Database::all(
                'SELECT d.*, c.username AS challenger_name, o.username AS opponent_name
                 FROM duels d JOIN users c ON c.id = d.challenger_id JOIN users o ON o.id = d.opponent_id
                 WHERE d.challenger_id = ? OR d.opponent_id = ? ORDER BY d.id',
                [$userId, $userId]
            ));
        }

        return $data;
    }

    /**
     * Verwijdert het account met alles erop. Onomkeerbaar.
     */
    public static function delete(int $userId): void
    {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            if (Database::hasTable('feedback_reports')) {
                Database::run(
                    'UPDATE feedback_reports SET contact_email = NULL, ip_hash = NULL, user_agent = NULL WHERE user_id = ?',
                    [$userId]
                );
            }
            if (Database::hasTable('tournament_competitors')) {
                Database::run(
                    "UPDATE tournament_competitors SET name = 'Oud-lid', ref_user_id = NULL WHERE ref_user_id = ?",
                    [$userId]
                );
            }
            Database::run('DELETE FROM users WHERE id = ?', [$userId]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Haalt verborgen kolommen weg en maakt JSON-kolommen (zoals de analyse
     * van een smart-cubesolve) weer leesbaar in plaats van een lange string.
     *
     * @param array<string,mixed> $rij
     * @return array<string,mixed>
     */
    private static function clean(array $rij): array
    {
        foreach (self::HIDDEN_COLUMNS as $kolom) {
            unset($rij[$kolom]);
        }
        foreach ($rij as $kolom => $waarde) {
            if (is_string($waarde) && $waarde !== '' && ($waarde[0] === '{' || $waarde[0] === '[')) {
                $json = json_decode($waarde, true);
                if (is_array($json)) {
                    $rij[$kolom] = $json;
                }
            }
        }
        return $rij;
    }
}
