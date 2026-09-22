-- =============================================================================
-- CubeTimer  |  migratie 005  |  Achievements
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `user_achievements` - welke achievement iemand wanneer heeft
--     behaald.
--
-- De achievements zelf staan NIET in de database maar in PHP
-- (lib/Achievements.php). Reden: het zijn er bijna honderd, ze veranderen mee
-- met de code die ze uitrekent, en zo staan de omschrijving, de drempel en de
-- controle bij elkaar in plaats van verspreid over code en data. Er is dus ook
-- geen migratie nodig als er een achievement bij komt.
--
-- `achievement_key` is bijvoorbeeld 'solves.goud' of 'secret.middernacht'.
-- De unieke sleutel zorgt dat een achievement maar een keer XP oplevert.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `user_achievements` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `achievement_key` VARCHAR(64)     NOT NULL,
  `tier`            VARCHAR(16)     NOT NULL DEFAULT 'brons' COMMENT 'brons | zilver | goud | platina | geheim',
  `xp_awarded`      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `unlocked_at`     DATETIME        NOT NULL COMMENT 'Wanneer het behaald is, in UTC',
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_achievements` (`user_id`, `achievement_key`),
  KEY `idx_user_achievements_recent` (`user_id`, `unlocked_at`),
  KEY `idx_user_achievements_key` (`achievement_key`)
    COMMENT 'Draagt de zeldzaamheid: hoeveel mensen hebben deze?',
  CONSTRAINT `fk_user_achievements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('005', 'Achievements: welke iemand behaald heeft en wanneer')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
