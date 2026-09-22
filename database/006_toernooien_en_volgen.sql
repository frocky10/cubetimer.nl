-- =============================================================================
-- CubeTimer  |  migratie 006  |  Toernooien en volgen
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `user_follows`            - wie volgt wie. Volgen jullie elkaar
--                                       allebei, dan zijn jullie vrienden.
--   * Maakt `tournaments`             - een gespeeld toernooi
--   * Maakt `tournament_competitors`  - het deelnemersveld van een toernooi
--   * Maakt `tournament_rounds`       - de rondes met hun cutoff en limiet
--   * Maakt `tournament_results`      - de uitslag per deelnemer per ronde
--   * Maakt `tournament_solves`       - de eigen solves van de speler
--   * Maakt `tournament_records`      - records uit toernooien, apart gehouden
--                                       van de gewone records
--
-- Waarom aparte records: een toernooitijd komt onder heel andere omstandigheden
-- tot stand dan een oefensolve. Ze horen niet door elkaar in dezelfde
-- gemiddelden, maar wel ergens zichtbaar te zijn. Vandaar een eigen tabel met
-- dezelfde vorm als `user_records`, die op het profiel een eigen blok krijgt.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- user_follows
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_follows` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `follower_id`  BIGINT UNSIGNED NOT NULL COMMENT 'Wie volgt',
  `following_id` BIGINT UNSIGNED NOT NULL COMMENT 'Wie gevolgd wordt',
  `created_at`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_follows` (`follower_id`, `following_id`),
  KEY `idx_user_follows_following` (`following_id`)
    COMMENT 'Voor het tellen van volgers en het vinden van wederzijdse paren',
  CONSTRAINT `fk_user_follows_follower` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_follows_following` FOREIGN KEY (`following_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournaments
--
--   difficulty : beginner | club | nationaal | wk | opmaat | open
--   status     : active | finished | abandoned
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournaments` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `event`          VARCHAR(24)     NOT NULL DEFAULT '333',
  `difficulty`     VARCHAR(16)     NOT NULL,
  `status`         VARCHAR(16)     NOT NULL DEFAULT 'active',
  `field_size`     SMALLINT UNSIGNED NOT NULL DEFAULT 32,
  `total_rounds`   TINYINT UNSIGNED  NOT NULL DEFAULT 3,
  `current_round`  TINYINT UNSIGNED  NOT NULL DEFAULT 1,
  `reference_ms`   INT UNSIGNED    NOT NULL COMMENT 'Het niveau waar het veld omheen gebouwd is',
  `final_position` SMALLINT UNSIGNED NULL DEFAULT NULL COMMENT 'Eindklassering, gevuld bij het afronden',
  `final_ao5_ms`   INT UNSIGNED    NULL DEFAULT NULL,
  `created_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at`    DATETIME        NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournaments_user` (`user_id`, `created_at`),
  KEY `idx_tournaments_open` (`user_id`, `status`),
  CONSTRAINT `fk_tournaments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournament_competitors
--
-- Het deelnemersveld. `kind` is 'player' (jij), 'bot' (verzonnen cuber) of
-- 'user' (een echte gebruiker van de site).
--
-- Bij een echte gebruiker worden zijn tijden NIET overgenomen: alleen zijn
-- niveau wordt gebruikt om tijden mee te simuleren. Hij heeft dus niet echt
-- meegedaan, en dat staat ook zo in de interface. Wie zichzelf van de
-- ranglijsten haalt, komt ook niet in een deelnemersveld terecht.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournament_competitors` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id` BIGINT UNSIGNED NOT NULL,
  `kind`          VARCHAR(8)      NOT NULL DEFAULT 'bot',
  `name`          VARCHAR(48)     NOT NULL,
  `country_code`  CHAR(2)         NULL DEFAULT NULL,
  `ref_user_id`   BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Alleen bij kind = user',
  `skill_ms`      INT UNSIGNED    NOT NULL COMMENT 'Gemiddelde tijd van deze deelnemer',
  `consistency`   SMALLINT UNSIGNED NOT NULL DEFAULT 12 COMMENT 'Spreiding in procenten van skill_ms',
  `form`          SMALLINT        NOT NULL DEFAULT 0 COMMENT 'Dagvorm in procenten, negatief is beter',
  `eliminated_in` TINYINT UNSIGNED NULL DEFAULT NULL COMMENT 'In welke ronde deze deelnemer afviel',
  PRIMARY KEY (`id`),
  KEY `idx_tournament_competitors` (`tournament_id`),
  CONSTRAINT `fk_tc_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tc_user` FOREIGN KEY (`ref_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournament_rounds
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournament_rounds` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id` BIGINT UNSIGNED NOT NULL,
  `round_number`  TINYINT UNSIGNED NOT NULL,
  `name`          VARCHAR(32)     NOT NULL,
  `entrants`      SMALLINT UNSIGNED NOT NULL,
  `advancing`     SMALLINT UNSIGNED NOT NULL COMMENT 'Hoeveel deelnemers doorgaan; 0 bij de finale',
  `cutoff_ms`     INT UNSIGNED    NULL DEFAULT NULL COMMENT 'Haal je die niet in twee solves, dan stopt je ronde',
  `time_limit_ms` INT UNSIGNED    NULL DEFAULT NULL COMMENT 'Boven deze tijd is een solve een DNF',
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'active',
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at`   DATETIME        NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tournament_rounds` (`tournament_id`, `round_number`),
  CONSTRAINT `fk_tr_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournament_results
--
-- De uitslag van een deelnemer in een ronde. `competitor_id` is NULL voor de
-- speler zelf; die staat niet in het deelnemersveld maar doet wel mee.
-- `times_json` bevat de vijf tijden zoals ze getoond worden.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournament_results` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id` BIGINT UNSIGNED NOT NULL,
  `round_number`  TINYINT UNSIGNED NOT NULL,
  `competitor_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'NULL = de speler zelf',
  `times_json`    TEXT            NULL DEFAULT NULL,
  `ao5_ms`        INT UNSIGNED    NULL DEFAULT NULL COMMENT 'NULL bij een DNF-gemiddelde of een cutoff',
  `best_ms`       INT UNSIGNED    NULL DEFAULT NULL,
  `position`      SMALLINT UNSIGNED NOT NULL,
  `advanced`      TINYINT(1)      NOT NULL DEFAULT 0,
  `cut`           TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Gestrand op de cutoff',
  PRIMARY KEY (`id`),
  KEY `idx_tournament_results` (`tournament_id`, `round_number`, `position`),
  CONSTRAINT `fk_tres_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tres_competitor` FOREIGN KEY (`competitor_id`) REFERENCES `tournament_competitors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournament_solves: de eigen solves van de speler
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournament_solves` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `round_number`   TINYINT UNSIGNED NOT NULL,
  `attempt_number` TINYINT UNSIGNED NOT NULL,
  `raw_ms`         INT UNSIGNED    NULL DEFAULT NULL,
  `penalty`        VARCHAR(8)      NOT NULL DEFAULT 'none',
  `scramble`       VARCHAR(1024)   NULL DEFAULT NULL,
  `solved_at`      DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tournament_solves` (`tournament_id`, `round_number`, `attempt_number`),
  KEY `idx_tournament_solves_user` (`user_id`),
  CONSTRAINT `fk_ts_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- tournament_records: apart van de gewone records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tournament_records` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `event`         VARCHAR(24)     NOT NULL,
  `category`      VARCHAR(16)     NOT NULL COMMENT 'single | ao5',
  `value_ms`      INT UNSIGNED    NOT NULL,
  `tournament_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `achieved_at`   DATETIME        NOT NULL,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tournament_records` (`user_id`, `event`, `category`),
  CONSTRAINT `fk_trec_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trec_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `tournaments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('006', 'Toernooien met bots en echte cubers, aparte toernooirecords, en volgen/vrienden')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
