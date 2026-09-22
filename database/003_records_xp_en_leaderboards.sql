-- =============================================================================
-- CubeTimer  |  migratie 003  |  Records, XP, levels en leaderboards
-- =============================================================================
-- Wat deze migratie doet:
--   * Breidt `user_profiles` uit met streak-velden (voor de XP-streakbonus)
--   * Maakt `user_records`  - beste (en slechtste) resultaat per gebruiker, per
--                             event, per categorie en per periode. Dit is de
--                             tabel waar de leaderboards uit gelezen worden.
--   * Maakt `solve_flags`   - solves die er te mooi uitzien om waar te zijn.
--                             Staat los van `solves` omdat die tabel bij elke
--                             synchronisatie volledig vervangen wordt; een
--                             markering moet dat overleven.
--   * Maakt `xp_events`     - logboek van alle toegekende XP. Ook de rem tegen
--                             dubbel toekennen: de unieke sleutel zorgt dat
--                             dezelfde gebeurtenis maar een keer telt.
--
-- Achtergrond bij `user_records`:
--   De server rekent na elke synchronisatie alle records opnieuw uit op basis
--   van de solves. De browser levert dus geen gemiddelden aan; die zou je
--   kunnen vervalsen. Zie lib/Records.php.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- user_profiles: streak bijhouden voor de XP-bonus
--
-- Via een hulpprocedure, want `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` kent
-- MySQL niet. Zo blijft ook deze migratie veilig om opnieuw te draaien.
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

CALL `cubetimer_add_column`('user_profiles', 'current_streak',
    "`current_streak` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Aantal dagen achter elkaar getimed' AFTER `level`");
CALL `cubetimer_add_column`('user_profiles', 'longest_streak',
    "`longest_streak` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Langste reeks ooit' AFTER `current_streak`");
CALL `cubetimer_add_column`('user_profiles', 'last_active_date',
    "`last_active_date` DATE NULL DEFAULT NULL COMMENT 'Laatste dag met een solve, in de sitetijdzone' AFTER `longest_streak`");
CALL `cubetimer_add_column`('user_profiles', 'show_on_leaderboard',
    "`show_on_leaderboard` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Uit = je verschijnt nergens in een ranglijst' AFTER `last_active_date`");

DROP PROCEDURE `cubetimer_add_column`;

-- -----------------------------------------------------------------------------
-- user_records
--
--   category : single | worst_single | mo3 | ao5 | ao12 | ao50 | ao100
--   period   : all | day | week
--   period_start : NULL bij 'all', anders de eerste dag van de periode in de
--                  tijdzone van de site (zie config: site_timezone). Zo
--                  concurreert iedereen op dezelfde dag en dezelfde week.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_records` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `event`           VARCHAR(24)     NOT NULL,
  `category`        VARCHAR(16)     NOT NULL,
  `period`          VARCHAR(8)      NOT NULL DEFAULT 'all',
  `period_start`    DATE            NULL DEFAULT NULL,
  `value_ms`        INT UNSIGNED    NOT NULL COMMENT 'Resultaat in milliseconden, straffen al verwerkt',
  `solve_client_id` VARCHAR(64)     NULL DEFAULT NULL COMMENT 'Alleen bij single: welke solve het was',
  `achieved_at`     DATETIME        NOT NULL COMMENT 'Tijdstip van de laatste solve uit het gemiddelde, in UTC',
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_records` (`user_id`, `event`, `category`, `period`, `period_start`),
  KEY `idx_user_records_board` (`event`, `category`, `period`, `period_start`, `value_ms`)
    COMMENT 'Draagt de leaderboardquery: filter op de eerste vier, sorteer op de laatste',
  CONSTRAINT `fk_user_records_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- solve_flags
--
-- Een solve die door de controle valt, komt hier te staan en telt niet mee voor
-- records en leaderboards tot hij is goedgekeurd. De gebruiker ziet zijn tijd
-- gewoon in zijn eigen sessie staan; alleen de ranglijst wacht.
--
--   status : pending | approved | rejected
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `solve_flags` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `solve_client_id` VARCHAR(64)     NOT NULL,
  `event`           VARCHAR(24)     NOT NULL,
  `value_ms`        INT UNSIGNED    NULL DEFAULT NULL,
  `reason`          VARCHAR(32)     NOT NULL COMMENT 'below_world_record | impossible | too_fast_for_user | burst',
  `detail`          VARCHAR(255)    NULL DEFAULT NULL COMMENT 'Uitleg in mensentaal, voor het beoordeelscherm',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'pending',
  `reviewed_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at`     TIMESTAMP       NULL DEFAULT NULL,
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_solve_flags` (`user_id`, `solve_client_id`),
  KEY `idx_solve_flags_status` (`status`, `created_at`),
  CONSTRAINT `fk_solve_flags_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_solve_flags_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- xp_events
--
-- Elke toekenning wordt hier vastgelegd. De unieke sleutel op
-- (user_id, type, reference) is wat voorkomt dat dezelfde solve of hetzelfde
-- record bij een volgende synchronisatie opnieuw XP oplevert.
--
--   type : solve | record | streak | challenge
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `xp_events` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `type`       VARCHAR(16)     NOT NULL,
  `reference`  VARCHAR(96)     NOT NULL COMMENT 'Wat het precies was: een solve-id, een record, een datum, een challenge',
  `amount`     INT             NOT NULL,
  `detail`     VARCHAR(191)    NULL DEFAULT NULL COMMENT 'Regel zoals de gebruiker hem te zien krijgt',
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_xp_events` (`user_id`, `type`, `reference`),
  KEY `idx_xp_events_recent` (`user_id`, `created_at`),
  CONSTRAINT `fk_xp_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('003', 'Records per event en periode, gemarkeerde solves, XP-logboek en streaks')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
