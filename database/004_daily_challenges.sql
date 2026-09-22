-- =============================================================================
-- CubeTimer  |  migratie 004  |  Daily challenges
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `scramble_pool`      - voorraad scrambles die bezoekers aanleveren
--   * Maakt `daily_challenges`   - de opdrachten van een dag
--   * Maakt `challenge_entries`  - de deelname van een gebruiker per opdracht
--
-- Waarom een scramblevoorraad:
--   Officiele WCA-scrambles worden gemaakt door cubing.js, dat alleen in de
--   browser draait; PHP kan dat niet. Ingelogde bezoekers leveren daarom
--   scrambles aan die in de voorraad terechtkomen. De server kiest daar per dag
--   willekeurig een uit, en gebruikt alleen scrambles die er minstens een dag
--   in staan. Zo kan niemand een makkelijke scramble inleveren en die meteen
--   zelf krijgen.
--
-- Soorten opdrachten (`daily_challenges.type`):
--   scramble_of_the_day  Iedereen dezelfde scramble, een poging, eigen ranglijst
--   solve_count          Doe X solves vandaag
--   beat_average         Doe een solve die X% sneller is dan je eigen Ao12
--   beat_personal_best   Verbeter vandaag je persoonlijk record op een event
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- scramble_pool
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `scramble_pool` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event`         VARCHAR(24)     NOT NULL,
  `scramble`      VARCHAR(1024)   NOT NULL,
  `scramble_hash` CHAR(64)        NOT NULL COMMENT 'SHA-256, houdt de voorraad vrij van dubbelen',
  `submitted_by`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `used_on`       DATE            NULL DEFAULT NULL COMMENT 'Gevuld zodra de scramble een keer gebruikt is',
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scramble_pool_hash` (`scramble_hash`),
  KEY `idx_scramble_pool_pick` (`event`, `used_on`, `created_at`),
  CONSTRAINT `fk_scramble_pool_user` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- daily_challenges
--
-- `payload` bevat de details per soort, als JSON:
--   scramble_of_the_day : {"scramble": "R U R' ...", "pool_id": 12}
--   solve_count         : {"target": 25}
--   beat_average        : {"percent": 5}
--   beat_personal_best  : {}
--
-- LONGTEXT in plaats van het JSON-type, zodat het ook werkt op oudere MySQL.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daily_challenges` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `challenge_date`  DATE            NOT NULL COMMENT 'De dag in de tijdzone van de site',
  `type`            VARCHAR(32)     NOT NULL,
  `event`           VARCHAR(24)     NOT NULL DEFAULT '333' COMMENT 'Leeg bij opdrachten die voor elk event gelden',
  `title`           VARCHAR(120)    NOT NULL,
  `description`     VARCHAR(255)    NOT NULL,
  `payload`         LONGTEXT        NULL DEFAULT NULL,
  `xp_reward`       SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  `sort_order`      TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_daily_challenges` (`challenge_date`, `type`, `event`),
  KEY `idx_daily_challenges_date` (`challenge_date`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- challenge_entries
--
-- Een rij per gebruiker per opdracht. Bij de scramble van de dag staat de
-- behaalde tijd in `value_ms` en is er maar een poging mogelijk; bij de andere
-- soorten telt `progress` op tot `target`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `challenge_entries` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `challenge_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `progress`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `target`          INT UNSIGNED    NOT NULL DEFAULT 1,
  `value_ms`        INT UNSIGNED    NULL DEFAULT NULL COMMENT 'Alleen bij de scramble van de dag',
  `penalty`         VARCHAR(8)      NOT NULL DEFAULT 'none',
  `solve_client_id` VARCHAR(64)     NULL DEFAULT NULL,
  `completed_at`    DATETIME        NULL DEFAULT NULL COMMENT 'Gevuld zodra de opdracht af is',
  `xp_awarded`      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_challenge_entries` (`challenge_id`, `user_id`),
  KEY `idx_challenge_entries_board` (`challenge_id`, `value_ms`)
    COMMENT 'Draagt de dagranglijst van de scramble van de dag',
  KEY `idx_challenge_entries_user` (`user_id`),
  CONSTRAINT `fk_challenge_entries_challenge` FOREIGN KEY (`challenge_id`) REFERENCES `daily_challenges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_challenge_entries_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('004', 'Daily challenges: scramblevoorraad, dagopdrachten en deelnames')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
