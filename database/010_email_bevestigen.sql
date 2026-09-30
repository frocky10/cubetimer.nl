-- =============================================================================
-- CubeTimer  |  migratie 010  |  E-mailadres bevestigen
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `email_verifications` - eenmalige tokens om je e-mailadres te
--     bevestigen. Dezelfde opzet als `password_resets` (migratie 001): in de
--     database staat alleen de SHA-256 van het token, het token zelf staat
--     alleen in de mail.
--
-- `users.email_verified_at` en `password_resets` bestonden al sinds 001 en
-- worden nu pas gebruikt; daar verandert niets aan.
--
-- Het adres staat erbij (`email_lower`): een link bevestigt alleen het adres
-- waarvoor hij verstuurd is. Verandert iemand ooit zijn adres, dan werkt een
-- oude link niet meer.
--
-- Deze migratie is veilig om opnieuw te draaien.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `email_lower` VARCHAR(191)    NOT NULL,
  `token_hash`  CHAR(64)        NOT NULL,
  `created_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`  TIMESTAMP       NOT NULL,
  `used_at`     TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_verifications_token` (`token_hash`),
  KEY `idx_email_verifications_user` (`user_id`),
  CONSTRAINT `fk_email_verifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('010', 'E-mailadres bevestigen: tokens in email_verifications')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
