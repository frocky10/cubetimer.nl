-- =============================================================================
-- CubeTimer  |  migratie 008  |  Analyse van smart-cubesolves
-- =============================================================================
-- Wat deze migratie doet:
--   * Voegt `solves.details` toe: een klein JSON-document met de analyse van
--     een solve die met een smart cube is gedaan. Aantal zetten, zetten per
--     seconde, de oplossing zelf, en per fase (kruis, F2L, OLL, PLL) de tijd
--     en het aantal zetten.
--
-- Waarom een tekstkolom en geen eigen tabel:
--   De analyse hoort bij één solve, wordt altijd in zijn geheel gelezen en
--   geschreven, en er wordt nooit op gezocht. Een tabel met een rij per fase
--   zou alleen maar joins opleveren. De server controleert en herschrijft de
--   inhoud voordat hij wordt opgeslagen (zie sync/push.php); wat de browser
--   stuurt komt er nooit letterlijk in.
--
-- Let op: de analyse telt nergens mee. Records, ranglijsten en XP komen uit de
-- tijd zelf, die de server als altijd uitrekent. De analyse is alleen iets om
-- je eigen solves terug te lezen, dus een verzonnen analyse levert niets op.
--
-- Deze migratie is veilig om opnieuw te draaien.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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

CALL `cubetimer_add_column`('solves', 'details',
    "`details` TEXT NULL DEFAULT NULL COMMENT 'Analyse van een smart-cubesolve (JSON), door de server gecontroleerd' AFTER `comment`");

DROP PROCEDURE IF EXISTS `cubetimer_add_column`;

-- -----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('008', 'Analyse van smart-cubesolves: zetten, TPS en tijd per fase')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
