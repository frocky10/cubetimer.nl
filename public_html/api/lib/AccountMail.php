<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Taal.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Mailer.php';

/**
 * De twee mails van een account: je adres bevestigen en je wachtwoord
 * vergeten.
 *
 * Beide werken met een eenmalig token van 64 tekens. In de database staat
 * alleen de SHA-256 ervan; wie de database leest, kan er dus niets mee. Het
 * token zelf staat alleen in de link in de mail.
 *
 * De link gaat naar de site met het token achter een hekje (/#bevestig=... en
 * /#herstel=...). Wat na een # staat stuurt de browser nooit naar een server,
 * en het komt dus ook niet in logbestanden of bij Google Analytics terecht.
 * account.js leest het uit en haalt het meteen uit de adresbalk.
 *
 *   Bevestigen      48 uur geldig. Niet verplicht: een onbevestigd account kan
 *                   alles, het accountvenster vraagt er alleen om.
 *   Wachtwoord      1 uur geldig, eenmalig. Na het herstellen worden alle
 *   vergeten        andere inlogsessies beëindigd, en geldt het adres meteen
 *                   als bevestigd (de mail kwam immers aan).
 */
final class AccountMail
{
    private const VERIFY_HOURS = 48;
    private const RESET_MINUTES = 60;

    public static function isAvailable(): bool
    {
        return Mailer::isEnabled() && Database::hasTable('email_verifications');
    }

    /* =====================================================================
     * Bevestigen
     * ================================================================== */

    /** Stuurt een bevestigingsmail naar het huidige adres van deze gebruiker. */
    public static function sendVerification(int $userId): bool
    {
        if (!self::isAvailable()) {
            return false;
        }
        $user = Database::first(
            'SELECT username, email, email_lower, email_verified_at FROM users WHERE id = ? AND is_active = 1',
            [$userId]
        );
        if ($user === null || $user['email_verified_at'] !== null) {
            return false;
        }

        $token = bin2hex(random_bytes(32));
        // Een nieuwe link maakt de oude ongeldig: er werkt er altijd maar één.
        Database::run('DELETE FROM email_verifications WHERE user_id = ?', [$userId]);
        Database::run(
            'INSERT INTO email_verifications (user_id, email_lower, token_hash, expires_at)
             VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL ' . self::VERIFY_HOURS . ' HOUR)',
            [$userId, $user['email_lower'], hash('sha256', $token)]
        );

        // De mail in de taal van de pagina waar het verzoek vandaan kwam, en de
        // link terug naar diezelfde taal (/en/#bevestig=...).
        $link = Mailer::siteUrl() . Taal::prefix() . '/#bevestig=' . $token;
        $aanhef = Taal::t('Hoi {naam},', ['naam' => (string) $user['username']]);
        $voetnoot = Taal::t('De link werkt {n} uur. Heb je geen account aangemaakt op CubeTimer, dan kun je deze mail negeren.', ['n' => self::VERIFY_HOURS]);

        return Mailer::send(
            (string) $user['email'],
            Taal::t('Bevestig je e-mailadres voor CubeTimer'),
            $aanhef . "\n\n"
                . Taal::t('Klik op deze link om je e-mailadres te bevestigen:') . "\n{$link}\n\n"
                . $voetnoot . "\n\nCubeTimer\n" . Mailer::siteUrl() . Taal::prefix() . "/\n",
            self::html(
                $aanhef,
                Taal::t('Klik op de knop om je e-mailadres te bevestigen. Dan kunnen we je helpen als je ooit je wachtwoord vergeet.'),
                Taal::t('E-mailadres bevestigen'),
                $link,
                $voetnoot
            )
        );
    }

    /** @return array{ok:bool,message:string} */
    public static function verify(string $token): array
    {
        if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            return ['ok' => false, 'message' => 'Deze bevestigingslink klopt niet.'];
        }

        $rij = Database::first(
            'SELECT v.id, v.user_id, v.email_lower, v.expires_at < UTC_TIMESTAMP() AS verlopen, v.used_at,
                    u.email_lower AS huidig, u.email_verified_at
             FROM email_verifications v JOIN users u ON u.id = v.user_id
             WHERE v.token_hash = ?',
            [hash('sha256', $token)]
        );

        if ($rij === null) {
            return ['ok' => false, 'message' => 'Deze bevestigingslink is niet (meer) geldig. Vraag in je account een nieuwe aan.'];
        }
        if ($rij['email_verified_at'] !== null) {
            return ['ok' => true, 'message' => 'Je e-mailadres was al bevestigd.'];
        }
        if ((int) $rij['verlopen'] === 1 || $rij['used_at'] !== null || $rij['email_lower'] !== $rij['huidig']) {
            return ['ok' => false, 'message' => 'Deze bevestigingslink is verlopen. Vraag in je account een nieuwe aan.'];
        }

        Database::run('UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?', [(int) $rij['user_id']]);
        Database::run('UPDATE email_verifications SET used_at = UTC_TIMESTAMP() WHERE id = ?', [(int) $rij['id']]);

        return ['ok' => true, 'message' => 'Je e-mailadres is bevestigd. Dank je!'];
    }

    /* =====================================================================
     * Wachtwoord vergeten
     * ================================================================== */

    /**
     * Stuurt een herstellink als het adres of de gebruikersnaam bestaat.
     * Zegt bewust niet of dat zo is: anders is dit een manier om uit te
     * zoeken wie er een account heeft.
     */
    public static function requestReset(string $identifier): void
    {
        if (!Mailer::isEnabled()) {
            return;
        }
        $identifier = strtolower(trim($identifier));
        if ($identifier === '') {
            return;
        }

        $user = Database::first(
            'SELECT id, username, email FROM users
             WHERE (email_lower = ? OR username_lower = ?) AND is_active = 1
             LIMIT 1',
            [$identifier, $identifier]
        );
        if ($user === null) {
            return;
        }

        $userId = (int) $user['id'];
        $token = bin2hex(random_bytes(32));
        // Er werkt er altijd maar één; een nieuwe aanvraag maakt de oude ongeldig.
        Database::run('DELETE FROM password_resets WHERE user_id = ?', [$userId]);
        Database::run(
            'INSERT INTO password_resets (user_id, token_hash, expires_at)
             VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ' . self::RESET_MINUTES . ' MINUTE)',
            [$userId, hash('sha256', $token)]
        );

        $link = Mailer::siteUrl() . Taal::prefix() . '/#herstel=' . $token;
        $aanhef = Taal::t('Hoi {naam},', ['naam' => (string) $user['username']]);
        $reden = Taal::t('Iemand (hopelijk jij) vroeg om een nieuw wachtwoord voor je CubeTimer-account.');
        $voetnoot = Taal::t('De link werkt {n} minuten en maar één keer. Heb je dit niet zelf gevraagd? Dan hoef je niets te doen; je wachtwoord blijft gewoon hetzelfde.', ['n' => self::RESET_MINUTES]);

        Mailer::send(
            (string) $user['email'],
            Taal::t('Je wachtwoord voor CubeTimer'),
            $aanhef . "\n\n" . $reden . "\n"
                . Taal::t('Kies een nieuw wachtwoord via deze link:') . "\n{$link}\n\n"
                . $voetnoot . "\n\nCubeTimer\n" . Mailer::siteUrl() . Taal::prefix() . "/\n",
            self::html(
                $aanhef,
                $reden,
                Taal::t('Nieuw wachtwoord kiezen'),
                $link,
                $voetnoot
            )
        );
    }

    /**
     * Zet een nieuw wachtwoord met een herstellink.
     *
     * @return array{ok:bool,message:string,userId?:int}
     */
    public static function resetPassword(string $token, string $password): array
    {
        if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            return ['ok' => false, 'message' => 'Deze herstellink klopt niet.'];
        }
        if (($fout = Auth::validatePassword($password)) !== null) {
            return ['ok' => false, 'message' => $fout];
        }

        $rij = Database::first(
            'SELECT r.id, r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
             WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > UTC_TIMESTAMP() AND u.is_active = 1',
            [hash('sha256', $token)]
        );
        if ($rij === null) {
            return ['ok' => false, 'message' => 'Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe aan.'];
        }
        $userId = (int) $rij['user_id'];

        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            Database::run(
                'UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP())
                 WHERE id = ?',
                [password_hash($password, PASSWORD_DEFAULT), $userId]
            );
            Database::run('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?', [(int) $rij['id']]);
            Database::run('DELETE FROM password_resets WHERE user_id = ? AND id <> ?', [$userId, (int) $rij['id']]);
            // Wie je wachtwoord kende, is nu overal uitgelogd.
            Database::run('DELETE FROM user_sessions WHERE user_id = ?', [$userId]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        return ['ok' => true, 'message' => 'Je wachtwoord is veranderd. Je bent nu ingelogd.', 'userId' => $userId];
    }

    /* =====================================================================
     * Opmaak
     * ================================================================== */

    /**
     * Een eenvoudige HTML-mail. Mailprogramma's lezen geen stylesheets, dus
     * alles staat inline; de kleuren zijn die van het donkere thema van de
     * site (het design system in style.css geldt hier niet).
     */
    private static function html(string $aanhef, string $tekst, string $knop, string $link, string $voetnoot): string
    {
        $e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $site = Mailer::siteUrl();

        return '<!DOCTYPE html><html lang="' . Taal::huidig() . '"><head><meta charset="UTF-8"></head>'
            . '<body style="margin:0;padding:24px;background:#f4f7fd;font-family:Arial,Helvetica,sans-serif;color:#0b1a33;">'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
            . 'style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;">'
            . '<tr><td style="font-size:20px;font-weight:bold;color:#0077ff;padding-bottom:16px;">CubeTimer</td></tr>'
            . '<tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px;">' . $e($aanhef) . '</td></tr>'
            . '<tr><td style="font-size:16px;line-height:1.5;padding-bottom:24px;">' . $e($tekst) . '</td></tr>'
            . '<tr><td style="padding-bottom:24px;"><a href="' . $e($link) . '" '
            . 'style="display:inline-block;background:#0077ff;color:#ffffff;text-decoration:none;'
            . 'font-weight:bold;padding:12px 20px;border-radius:10px;">' . $e($knop) . '</a></td></tr>'
            . '<tr><td style="font-size:13px;line-height:1.5;color:#5b6b85;padding-bottom:8px;">' . $e($voetnoot) . '</td></tr>'
            . '<tr><td style="font-size:12px;line-height:1.5;color:#8a97ad;word-break:break-all;">'
            . $e(Taal::t('Werkt de knop niet? Kopieer dan deze link:')) . ' ' . $e($link) . '</td></tr>'
            . '</table>'
            . '<p style="font-size:12px;color:#8a97ad;">' . $e($site) . '</p>'
            . '</td></tr></table></body></html>';
    }
}
