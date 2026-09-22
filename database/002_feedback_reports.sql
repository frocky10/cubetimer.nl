-- =============================================================================
-- CubeTimer  |  migratie 002  |  Logboek van bug- en feature-meldingen
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `feedback_reports` - logt iedere melding die via de bug-knop naar
--     GitHub is gestuurd, inclusief het aangemaakte issue-nummer.
--
-- Waarom: zo is achteraf te zien hoeveel meldingen er binnenkomen, kan spam
-- herkend worden, en is een melding terug te koppelen aan een ingelogde
-- gebruiker zonder dat diens e-mailadres in het publieke GitHub-issue belandt.
--
-- Let op: de bug-knop werkt ook zonder database. Als deze tabel ontbreekt,
-- slaat de API het loggen stilzwijgend over en wordt het issue gewoon
-- aangemaakt. De rate limiting draait op bestanden, niet op deze tabel.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `feedback_reports` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'NULL bij een melding van een niet-ingelogde bezoeker',
  `type`          VARCHAR(16)     NOT NULL DEFAULT 'bug' COMMENT 'bug | feature',
  `title`         VARCHAR(191)    NOT NULL,
  `body`          TEXT            NULL DEFAULT NULL,
  `contact_email` VARCHAR(191)    NULL DEFAULT NULL COMMENT 'Optioneel, alleen voor terugkoppeling. Komt niet in het GitHub-issue.',
  `issue_number`  INT UNSIGNED    NULL DEFAULT NULL,
  `issue_url`     VARCHAR(255)    NULL DEFAULT NULL,
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'submitted' COMMENT 'submitted | failed',
  `ip_hash`       CHAR(64)        NULL DEFAULT NULL COMMENT 'Gehasht IP, niet herleidbaar (AVG)',
  `user_agent`    VARCHAR(255)    NULL DEFAULT NULL,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feedback_reports_user` (`user_id`),
  KEY `idx_feedback_reports_created` (`created_at`),
  CONSTRAINT `fk_feedback_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('002', 'Logboek van bug- en feature-meldingen uit de bug-knop')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
