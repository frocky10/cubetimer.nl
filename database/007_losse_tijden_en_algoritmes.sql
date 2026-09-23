-- =============================================================================
-- CubeTimer  |  migratie 007  |  Losse tijden en geleerde algoritmes
-- =============================================================================
-- Wat deze migratie doet:
--   * Laat `solves.timer_session_id` leeg zijn. Een solve zonder sessie is een
--     *losse tijd*: hij staat nog gewoon op je account en telt mee voor je
--     records, ranglijsten, XP en achievements, maar hij hangt niet meer onder
--     een sessie in de timer.
--   * Zet de sleutel naar `timer_sessions` om van ON DELETE CASCADE naar
--     ON DELETE SET NULL. Een sessie weggooien wist daarmee de tijden niet
--     meer; ze worden los.
--   * Maakt `user_algorithms` - welke OLL/PLL/F2L-gevallen iemand als geleerd
--     heeft afgevinkt op de tutorialpagina.
--
-- Waarom:
--   Tot nu toe was een sessie verwijderen hetzelfde als de tijden erin
--   weggooien, want de synchronisatie verving de hele staat van een gebruiker
--   door wat de browser stuurde. Wie op zijn telefoon opruimde, raakte op zijn
--   account solves kwijt die daar al maanden stonden. Sessies zijn bedoeld om
--   te ordenen waar je mee bezig bent; dat hoort geen gegevens te kosten.
--   Vanaf nu is er een apart "en ook uit mijn account verwijderen", en dat is
--   het enige wat echt wist.
--
-- Deze migratie is veilig om opnieuw te draaien.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- solves: de sessie mag losgelaten worden
--
-- De naam van de sleutel ligt vast in 001, maar op een installatie die
-- tussendoor met de hand is bijgewerkt kan hij ontbreken. Daarom eerst kijken
-- of hij er is, in plaats van er blind op te vertrouwen.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `cubetimer_drop_foreign_key`;

DELIMITER //
CREATE PROCEDURE `cubetimer_drop_foreign_key`(IN tbl VARCHAR(64), IN fk VARCHAR(64))
BEGIN
    DECLARE aanwezig INT DEFAULT 0;

    SELECT COUNT(*) INTO aanwezig
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = tbl
      AND constraint_name = fk
      AND constraint_type = 'FOREIGN KEY';

    IF aanwezig > 0 THEN
        SET @ddl = CONCAT('ALTER TABLE `', tbl, '` DROP FOREIGN KEY `', fk, '`');
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL `cubetimer_drop_foreign_key`('solves', 'fk_solves_session');

-- De kolom mag leeg zijn. Dit is ook los van de sleutel veilig om te herhalen:
-- MODIFY zet de kolom simpelweg nog een keer in dezelfde vorm.
ALTER TABLE `solves`
    MODIFY COLUMN `timer_session_id` BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Leeg = losse tijd: staat op het account, maar niet meer in een sessie';

ALTER TABLE `solves`
    ADD CONSTRAINT `fk_solves_session` FOREIGN KEY (`timer_session_id`)
    REFERENCES `timer_sessions` (`id`) ON DELETE SET NULL;

DROP PROCEDURE IF EXISTS `cubetimer_drop_foreign_key`;

-- Losse tijden opzoeken gebeurt per gebruiker; dat is met deze index een
-- kwestie van de rijen met een lege sessie eruit pikken.
DROP PROCEDURE IF EXISTS `cubetimer_add_index`;

DELIMITER //
CREATE PROCEDURE `cubetimer_add_index`(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols TEXT)
BEGIN
    DECLARE aanwezig INT DEFAULT 0;

    SELECT COUNT(*) INTO aanwezig
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx;

    IF aanwezig = 0 THEN
        SET @ddl = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (', cols, ')');
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL `cubetimer_add_index`('solves', 'idx_solves_user_session', '`user_id`, `timer_session_id`');

DROP PROCEDURE IF EXISTS `cubetimer_add_index`;

-- -----------------------------------------------------------------------------
-- user_algorithms: afgevinkte gevallen op de tutorialpagina
--
-- `algorithm_id` is de id uit Script/algorithms.js, bijvoorbeeld 'OLL-27',
-- 'PLL-T' of 'F2L-13'. Bewust geen aparte tabel met de catalogus erin: de
-- algoritmes staan in het JavaScript en veranderen alleen als iemand die lijst
-- aanpast. Een onbekende id hier is hooguit een vinkje dat nergens meer bij
-- hoort, en dat valt op de pagina vanzelf weg.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_algorithms` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `algorithm_id` VARCHAR(32)     NOT NULL COMMENT "Bijvoorbeeld 'OLL-27', 'PLL-T' of 'F2L-13'",
  `learned_at`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_algorithms` (`user_id`, `algorithm_id`),
  CONSTRAINT `fk_user_algorithms_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('007', 'Losse tijden (sessie mag leeg zijn) en geleerde algoritmes')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
