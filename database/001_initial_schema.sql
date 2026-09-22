-- =============================================================================
-- CubeTimer  |  migratie 001  |  Initieel schema
-- =============================================================================
-- Wat deze migratie doet:
--   * Maakt de migratietabel `schema_migrations` aan (houdt bij wat al gedraaid is)
--   * Maakt `users`            - accounts (inloggegevens)
--   * Maakt `user_profiles`    - publieke profielgegevens + ruimte voor XP/level/rank
--   * Maakt `user_sessions`    - inlogsessies (auth-tokens uit de cookie)
--   * Maakt `password_resets`  - tokens voor 'wachtwoord vergeten'
--   * Maakt `timer_sessions`   - de sessies uit de timer (Session 1, 2, ...)
--   * Maakt `solves`           - alle losse tijden, met event + timestamp
--
-- Importeren: phpMyAdmin > selecteer de database > tabblad Importeren > dit bestand.
-- Deze migratie is veilig om opnieuw te draaien (CREATE TABLE IF NOT EXISTS).
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- schema_migrations: welke migraties zijn al geimporteerd
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version`     VARCHAR(20)  NOT NULL,
  `description` VARCHAR(191) NOT NULL,
  `applied_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- users: inloggegevens
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id`       CHAR(36)        NOT NULL COMMENT 'UUID, gebruikt in API-antwoorden i.p.v. het autonummer',
  `username`        VARCHAR(32)     NOT NULL COMMENT 'Uniek, wordt getoond in leaderboards',
  `username_lower`  VARCHAR(32)     NOT NULL COMMENT 'Lowercase kopie voor hoofdletterongevoelige uniciteit',
  `email`           VARCHAR(191)    NOT NULL,
  `email_lower`     VARCHAR(191)    NOT NULL,
  `password_hash`   VARCHAR(255)    NOT NULL COMMENT 'password_hash() output, nooit een plain wachtwoord',
  `email_verified_at` TIMESTAMP     NULL DEFAULT NULL,
  `is_active`       TINYINT(1)      NOT NULL DEFAULT 1,
  `role`            VARCHAR(20)     NOT NULL DEFAULT 'user' COMMENT 'user | moderator | admin',
  `last_login_at`   TIMESTAMP       NULL DEFAULT NULL,
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_public_id` (`public_id`),
  UNIQUE KEY `uq_users_username_lower` (`username_lower`),
  UNIQUE KEY `uq_users_email_lower` (`email_lower`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- user_profiles: alles wat niet met inloggen te maken heeft
-- Losgekoppeld van `users` zodat latere features (XP #28, rank #26, achievements
-- #27) hier bij kunnen zonder de inlogtabel aan te raken.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `display_name`  VARCHAR(48)     NULL DEFAULT NULL,
  `country_code`  CHAR(2)         NULL DEFAULT NULL COMMENT 'ISO 3166-1 alpha-2, voor leaderboards',
  `wca_id`        VARCHAR(10)     NULL DEFAULT NULL,
  `avatar_url`    VARCHAR(255)    NULL DEFAULT NULL,
  `main_event`    VARCHAR(24)     NOT NULL DEFAULT '333',
  `xp`            INT UNSIGNED    NOT NULL DEFAULT 0,
  `level`         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- user_sessions: actieve logins. De cookie bevat het token, de database alleen
-- de SHA-256 hash ervan, zodat een datalek geen bruikbare sessies oplevert.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `token_hash`   CHAR(64)        NOT NULL COMMENT 'SHA-256 van het sessietoken',
  `user_agent`   VARCHAR(191)    NULL DEFAULT NULL,
  `ip_hash`      CHAR(64)        NULL DEFAULT NULL COMMENT 'Gehasht IP, niet herleidbaar (AVG)',
  `created_at`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   TIMESTAMP       NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_sessions_token` (`token_hash`),
  KEY `idx_user_sessions_user` (`user_id`),
  KEY `idx_user_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- password_resets: eenmalige tokens voor 'wachtwoord vergeten'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64)        NOT NULL,
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP       NOT NULL,
  `used_at`    TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_resets_token` (`token_hash`),
  KEY `idx_password_resets_user` (`user_id`),
  CONSTRAINT `fk_password_resets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- timer_sessions: de sessies uit de sidebar. `client_id` is het id dat de
-- browser al genereert (session-<timestamp>-<random>), zodat lokale data en
-- serverdata aan elkaar te koppelen zijn.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `timer_sessions` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `client_id`  VARCHAR(64)     NOT NULL COMMENT 'Id uit localStorage van de browser',
  `name`       VARCHAR(64)     NOT NULL,
  `event`      VARCHAR(24)     NOT NULL DEFAULT '333' COMMENT 'WCA event-id: 333, 222, pyram, ...',
  `sort_order` INT             NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_timer_sessions_user_client` (`user_id`, `client_id`),
  KEY `idx_timer_sessions_user` (`user_id`),
  CONSTRAINT `fk_timer_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- solves: iedere losse tijd.
--   raw_ms  = de onbewerkte tijd in milliseconden (NULL bij een DNF zonder tijd)
--   penalty = 'none' | 'plus2' | 'dnf'   (de +2 wordt NIET in raw_ms verwerkt)
--   `event` staat ook hier, gedupliceerd vanuit timer_sessions, zodat de daily/
--   weekly statistieken per event in een enkele query kunnen zonder JOIN.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `solves` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT UNSIGNED NOT NULL,
  `timer_session_id` BIGINT UNSIGNED NOT NULL,
  `client_id`        VARCHAR(64)     NOT NULL COMMENT 'Uniek id per solve, gegenereerd in de browser',
  `event`            VARCHAR(24)     NOT NULL DEFAULT '333',
  `raw_ms`           INT UNSIGNED    NULL DEFAULT NULL,
  `penalty`          VARCHAR(8)      NOT NULL DEFAULT 'none' COMMENT 'none | plus2 | dnf',
  `scramble`         TEXT            NULL DEFAULT NULL,
  `source`           VARCHAR(16)     NOT NULL DEFAULT 'manual' COMMENT 'manual | bluetooth',
  `comment`          VARCHAR(255)    NULL DEFAULT NULL,
  `solved_at`        DATETIME        NOT NULL COMMENT 'Tijdstip van de solve in UTC',
  `created_at`       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_solves_user_client` (`user_id`, `client_id`),
  KEY `idx_solves_session` (`timer_session_id`),
  KEY `idx_solves_user_event_solved` (`user_id`, `event`, `solved_at`) COMMENT 'Draagt de daily/weekly averages',
  CONSTRAINT `fk_solves_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_solves_session` FOREIGN KEY (`timer_session_id`) REFERENCES `timer_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`version`, `description`)
VALUES ('001', 'Initieel schema: users, profielen, inlogsessies, timer-sessies en solves')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
