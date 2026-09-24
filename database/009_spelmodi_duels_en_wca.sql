-- =============================================================================
-- CubeTimer  |  migratie 009  |  Spelmodi, duels en historische WCA-toernooien
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt `game_runs`      - een gespeelde ronde van een spelmodus (streak,
--                              survival, ladder, speedrun). Het record per modus
--                              is gewoon de beste rij; daar is geen aparte
--                              tabel voor nodig.
--   * Maakt `duels`          - een duel tussen twee vrienden op dezelfde
--                              scrambles, met per kant de uitslag
--   * Maakt `duel_attempts`  - de losse solves in een duel
--   * Maakt `wca_cache`      - wat de server bij de WCA heeft opgehaald:
--                              zoekresultaten en de uitslagen van een comp
--   * Breidt `tournaments` uit met de bron (gesimuleerd of een echte comp) en
--     een momentopname van de echte uitslagen van het gekozen event
--   * Breidt `tournament_rounds` uit met het format van een ronde (Ao5, Mo3,
--     best of), het aantal pogingen, de cutoff in pogingen en een
--     cumulatieve tijdslimiet. Een echte comp kent die allemaal.
--   * Breidt `tournament_competitors` uit met het WCA-id van een echte cuber
--
-- Bestaande toernooien houden hun waarden: de nieuwe kolommen hebben
-- standaardwaarden die precies de oude opzet beschrijven (Ao5, cutoff na twee).
--
-- Deze migratie is veilig om opnieuw te draaien.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- game_runs
--
--   mode    : streak | survival | ladder | speedrun
--   variant : wat de modus instelbaar maakt. Streak: de doeltijd in ms.
--             Survival: de startlimiet in ms. Speedrun: het aantal cubes.
--             Ladder: 0. Een record geldt per modus, event en variant.
--   score   : hoe ver je kwam (solves op rij, cubes binnen vijf minuten)
--   tiebreak_ms : bij een gelijke score wint de laagste. Per modus
--             uitgelegd in lib/GameModes.php.
--   details : de solves of de rondetijden, door de server gecontroleerd
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `game_runs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `mode`        VARCHAR(16)     NOT NULL,
  `event`       VARCHAR(24)     NOT NULL DEFAULT '333',
  `variant`     INT UNSIGNED    NOT NULL DEFAULT 0,
  `score`       INT UNSIGNED    NOT NULL DEFAULT 0,
  `tiebreak_ms` INT UNSIGNED    NULL DEFAULT NULL,
  `details`     MEDIUMTEXT      NULL DEFAULT NULL,
  `created_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_game_runs_record` (`user_id`, `mode`, `event`, `variant`, `score`),
  KEY `idx_game_runs_recent` (`user_id`, `created_at`),
  CONSTRAINT `fk_game_runs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- duels
--
--   status : open | finished | expired | declined | cancelled
--   format : a (Ao5) | m (Mo3) | 3 (best of 3), afhankelijk van het event
--   *_avg_ms / *_best_ms / *_done : de uitslag per kant, gevuld zodra die
--             kant al zijn pogingen heeft gedaan
--   winner_id : NULL bij gelijkspel, of als nog niemand klaar is
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `duels` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `challenger_id`      BIGINT UNSIGNED NOT NULL,
  `opponent_id`        BIGINT UNSIGNED NOT NULL,
  `event`              VARCHAR(24)     NOT NULL DEFAULT '333',
  `format`             CHAR(1)         NOT NULL DEFAULT 'a',
  `scrambles`          TEXT            NOT NULL COMMENT 'JSON-lijst, voor beide kanten dezelfde',
  `status`             VARCHAR(16)     NOT NULL DEFAULT 'open',
  `challenger_avg_ms`  INT UNSIGNED    NULL DEFAULT NULL,
  `challenger_best_ms` INT UNSIGNED    NULL DEFAULT NULL,
  `challenger_done`    TINYINT(1)      NOT NULL DEFAULT 0,
  `opponent_avg_ms`    INT UNSIGNED    NULL DEFAULT NULL,
  `opponent_best_ms`   INT UNSIGNED    NULL DEFAULT NULL,
  `opponent_done`      TINYINT(1)      NOT NULL DEFAULT 0,
  `winner_id`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`         DATETIME        NOT NULL,
  `finished_at`        DATETIME        NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_duels_challenger` (`challenger_id`, `status`),
  KEY `idx_duels_opponent` (`opponent_id`, `status`),
  CONSTRAINT `fk_duels_challenger` FOREIGN KEY (`challenger_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_duels_opponent` FOREIGN KEY (`opponent_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_duels_winner` FOREIGN KEY (`winner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `duel_attempts` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `duel_id`        BIGINT UNSIGNED NOT NULL,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `attempt_number` TINYINT UNSIGNED NOT NULL,
  `raw_ms`         INT UNSIGNED    NULL DEFAULT NULL,
  `penalty`        VARCHAR(8)      NOT NULL DEFAULT 'none',
  `solved_at`      DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_duel_attempts` (`duel_id`, `user_id`, `attempt_number`),
  CONSTRAINT `fk_da_duel` FOREIGN KEY (`duel_id`) REFERENCES `duels` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_da_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- wca_cache
--
-- Een sleutel-waardeopslag voor wat er bij de WCA is opgehaald. De uitslagen
-- van een afgelopen comp veranderen vrijwel nooit, dus die blijven lang
-- staan; zoekresultaten een dag. Kan de WCA even niet, dan gebruikt de server
-- een verlopen kopie in plaats van niets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wca_cache` (
  `cache_key`  VARCHAR(191)    NOT NULL,
  `payload`    MEDIUMTEXT      NOT NULL,
  `fetched_at` DATETIME        NOT NULL,
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Kolommen op de bestaande toernooitabellen
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `cubetimer_add_column`;

DELIMITER //
CREATE PROCEDURE `cubetimer_add_column`(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
    DECLARE aanwezig INT DEFAULT 0;

    SELECT COUNT(*) INTO aanwezig
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col;

    IF aanwezig = 0 THEN
        SET @ddl = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL `cubetimer_add_column`('tournaments', 'source',
    "`source` VARCHAR(8) NOT NULL DEFAULT 'sim' COMMENT 'sim (bots) of wca (een echte comp)' AFTER `difficulty`");
CALL `cubetimer_add_column`('tournaments', 'wca_competition_id',
    "`wca_competition_id` VARCHAR(32) NULL DEFAULT NULL AFTER `source`");
CALL `cubetimer_add_column`('tournaments', 'wca_name',
    "`wca_name` VARCHAR(128) NULL DEFAULT NULL AFTER `wca_competition_id`");
CALL `cubetimer_add_column`('tournaments', 'wca_snapshot',
    "`wca_snapshot` MEDIUMTEXT NULL DEFAULT NULL COMMENT 'De echte uitslagen van het gekozen event, bij de start vastgelegd' AFTER `wca_name`");

CALL `cubetimer_add_column`('tournament_rounds', 'format',
    "`format` CHAR(1) NOT NULL DEFAULT 'a' COMMENT 'a = Ao5, m = Mo3, 1/2/3 = best of' AFTER `advancing`");
CALL `cubetimer_add_column`('tournament_rounds', 'attempts',
    "`attempts` TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER `format`");
CALL `cubetimer_add_column`('tournament_rounds', 'cutoff_attempts',
    "`cutoff_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT 'Binnen hoeveel pogingen de cutoff gehaald moet worden' AFTER `cutoff_ms`");
CALL `cubetimer_add_column`('tournament_rounds', 'limit_cumulative',
    "`limit_cumulative` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = de tijdslimiet geldt voor alle pogingen samen' AFTER `time_limit_ms`");

CALL `cubetimer_add_column`('tournament_competitors', 'wca_id',
    "`wca_id` VARCHAR(10) NULL DEFAULT NULL COMMENT 'Alleen bij kind = wca' AFTER `ref_user_id`");

DROP PROCEDURE IF EXISTS `cubetimer_add_column`;

-- -----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('009', 'Spelmodi met records, duels tussen vrienden, en toernooien op historische WCA-comps')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
