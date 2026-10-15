/* =====================================================================
   QCH Connect - Migration 001: Core schema
   Target: Azure SQL Database (T-SQL).
   Matches the Final Technical PRD (Oct 14, 2026), which supersedes
   Mini PRD v4 and the Working Draft.

   Conventions
   - All timestamps are stored in UTC (DATETIME2(3), SYSUTCDATETIME()).
     Display and reporting convert to the QCH-approved business time zone,
     read from configuration, with daylight-saving awareness. No time zone
     or fixed UTC offset is hard-coded here (PRD 9.7).
   - Lifecycle: departments, programs, and fields store only ACTIVE,
     DISCONTINUED, or RETIRED. "Reactivated" is not a stored status; it is
     an audited transition back to ACTIVE (audit_events action REACTIVATED).
     New rows start as ACTIVE; creation is audited as CREATED (PRD 4.3, 4.4).
   - Mutable tables carry ROWVERSION for optimistic concurrency (PRD 9.4).
   - The database enforces structural rules (CHECK / FK / UNIQUE).
     Workflow transitions (who may change what, and when) are enforced
     by the Node.js backend (PRD 9.5, 6.4).
   - Run with sqlcmd or Azure Data Studio; "GO" separates batches.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Departments  (PRD 4.4, 9.1)
   --------------------------------------------------------------------- */
CREATE TABLE dbo.departments (
    department_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_departments PRIMARY KEY,
    name               NVARCHAR(200)     NOT NULL,
    lifecycle_status   NVARCHAR(20)      NOT NULL CONSTRAINT df_departments_status DEFAULT 'ACTIVE',
    created_at         DATETIME2(3)      NOT NULL CONSTRAINT df_departments_created DEFAULT SYSUTCDATETIME(),
    updated_at         DATETIME2(3)      NOT NULL CONSTRAINT df_departments_updated DEFAULT SYSUTCDATETIME(),
    row_version        ROWVERSION        NOT NULL,
    CONSTRAINT uq_departments_name UNIQUE (name),
    CONSTRAINT ck_departments_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED'))
);
GO

/* ---------------------------------------------------------------------
   2. Programs  (PRD 4.1, 4.2, 4.4, 9.1)
   System-required and common searchable fields live here.
   Program-specific fields live in field_definitions / program_field_values.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.programs (
    program_id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_programs PRIMARY KEY,
    department_id           INT            NOT NULL CONSTRAINT fk_programs_department REFERENCES dbo.departments(department_id),
    name                    NVARCHAR(200)  NOT NULL,
    site                    NVARCHAR(200)  NULL,
    description             NVARCHAR(MAX)  NULL,
    eligibility_notes       NVARCHAR(MAX)  NULL,
    schedule_notes          NVARCHAR(MAX)  NULL,
    cost_notes              NVARCHAR(1000) NULL,
    age_min                 TINYINT        NULL,
    age_max                 TINYINT        NULL,
    grades                  NVARCHAR(50)   NULL,
    -- TEAM CLASSIFICATION, NOT QCH VOCABULARY: no allowed-value list is
    -- enforced until QCH confirms how it describes enrollment and referral paths.
    enrollment_type         NVARCHAR(20)   NULL,
    referral_path           NVARCHAR(40)   NULL,
    notification_email      NVARCHAR(320)  NULL,   -- receiving destination; server-side only (PRD 11.3)
    lifecycle_status        NVARCHAR(20)   NOT NULL CONSTRAINT df_programs_status DEFAULT 'ACTIVE',
    created_at              DATETIME2(3)   NOT NULL CONSTRAINT df_programs_created DEFAULT SYSUTCDATETIME(),
    updated_at              DATETIME2(3)   NOT NULL CONSTRAINT df_programs_updated DEFAULT SYSUTCDATETIME(),
    row_version             ROWVERSION     NOT NULL,
    CONSTRAINT uq_programs_name_site UNIQUE (name, site),
    CONSTRAINT ck_programs_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED')),
    CONSTRAINT ck_programs_ages CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max)
);
GO

/* Multi-valued searchable attributes get their own tables (PRD 9.9). */
CREATE TABLE dbo.service_categories (
    service_category_id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_service_categories PRIMARY KEY,
    name                NVARCHAR(100) NOT NULL CONSTRAINT uq_service_categories_name UNIQUE,
    lifecycle_status    NVARCHAR(20)  NOT NULL CONSTRAINT df_service_categories_status DEFAULT 'ACTIVE',
    CONSTRAINT ck_service_categories_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED'))
);
GO

CREATE TABLE dbo.program_service_categories (
    program_id          INT NOT NULL CONSTRAINT fk_psc_program REFERENCES dbo.programs(program_id),
    service_category_id INT NOT NULL CONSTRAINT fk_psc_category REFERENCES dbo.service_categories(service_category_id),
    CONSTRAINT pk_program_service_categories PRIMARY KEY (program_id, service_category_id)
);
GO

CREATE TABLE dbo.program_zip_codes (
    program_id INT     NOT NULL CONSTRAINT fk_pzip_program REFERENCES dbo.programs(program_id),
    zip_code   CHAR(5) NOT NULL,
    CONSTRAINT pk_program_zip_codes PRIMARY KEY (program_id, zip_code),
    CONSTRAINT ck_pzip_format CHECK (zip_code LIKE '[0-9][0-9][0-9][0-9][0-9]')
);
GO

/* ---------------------------------------------------------------------
   3. Configurable fields  (PRD 4.2, 4.3, 9.1)
   A field's identity follows its meaning. A wording-only rename keeps
   field_id; a meaning change discontinues the field and creates a new
   one linked by replaced_by_field_id.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.field_definitions (
    field_id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_field_definitions PRIMARY KEY,
    field_key             NVARCHAR(100) NOT NULL CONSTRAINT uq_field_definitions_key UNIQUE,
    label                 NVARCHAR(200) NOT NULL,
    applies_to            NVARCHAR(20)  NOT NULL,   -- program info, or extra referral-form question
    data_type             NVARCHAR(20)  NOT NULL,
    lifecycle_status      NVARCHAR(20)  NOT NULL CONSTRAINT df_field_definitions_status DEFAULT 'ACTIVE',
    replaced_by_field_id  INT           NULL CONSTRAINT fk_field_definitions_replaced_by REFERENCES dbo.field_definitions(field_id),
    discontinued_at       DATETIME2(3)  NULL,
    retired_at            DATETIME2(3)  NULL,
    created_at            DATETIME2(3)  NOT NULL CONSTRAINT df_field_definitions_created DEFAULT SYSUTCDATETIME(),
    row_version           ROWVERSION    NOT NULL,
    CONSTRAINT ck_field_definitions_applies CHECK (applies_to IN ('PROGRAM_INFO','REFERRAL_FORM')),
    CONSTRAINT ck_field_definitions_type CHECK (data_type IN ('TEXT','NUMBER','DATE','BOOLEAN','SINGLE_SELECT','MULTI_SELECT')),
    CONSTRAINT ck_field_definitions_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED')),
    CONSTRAINT ck_field_definitions_not_self CHECK (replaced_by_field_id IS NULL OR replaced_by_field_id <> field_id)
);
GO

CREATE TABLE dbo.field_options (
    option_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_field_options PRIMARY KEY,
    field_id          INT           NOT NULL CONSTRAINT fk_field_options_field REFERENCES dbo.field_definitions(field_id),
    label             NVARCHAR(200) NOT NULL,
    display_order     INT           NOT NULL CONSTRAINT df_field_options_order DEFAULT 0,
    lifecycle_status  NVARCHAR(20)  NOT NULL CONSTRAINT df_field_options_status DEFAULT 'ACTIVE',
    row_version       ROWVERSION    NOT NULL,
    CONSTRAINT ck_field_options_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED')),
    -- Lets value tables require that an option belongs to the same field (PRD 4.2)
    CONSTRAINT uq_field_options_option_field UNIQUE (option_id, field_id)
);
GO

CREATE TABLE dbo.program_field_applicability (
    program_id     INT NOT NULL CONSTRAINT fk_pfa_program REFERENCES dbo.programs(program_id),
    field_id       INT NOT NULL CONSTRAINT fk_pfa_field REFERENCES dbo.field_definitions(field_id),
    is_required    BIT NOT NULL CONSTRAINT df_pfa_required DEFAULT 0,
    display_order  INT NOT NULL CONSTRAINT df_pfa_order DEFAULT 0,
    row_version    ROWVERSION NOT NULL,
    CONSTRAINT pk_program_field_applicability PRIMARY KEY (program_id, field_id)
);
GO

/* Exactly one value column is filled per row. Multi-select = one row per option.
   The unique key allows one non-option value per program+field, since
   SQL Server treats NULL option_id values as equal in a UNIQUE constraint. */
CREATE TABLE dbo.program_field_values (
    value_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_program_field_values PRIMARY KEY,
    program_id    INT            NOT NULL CONSTRAINT fk_pfv_program REFERENCES dbo.programs(program_id),
    field_id      INT            NOT NULL CONSTRAINT fk_pfv_field REFERENCES dbo.field_definitions(field_id),
    option_id     INT            NULL,
    value_text    NVARCHAR(2000) NULL,
    value_number  DECIMAL(18,4)  NULL,
    value_date    DATE           NULL,
    value_bool    BIT            NULL,
    updated_at    DATETIME2(3)   NOT NULL CONSTRAINT df_pfv_updated DEFAULT SYSUTCDATETIME(),
    row_version   ROWVERSION     NOT NULL,
    CONSTRAINT uq_pfv UNIQUE (program_id, field_id, option_id),
    -- The option must belong to this same field. Not checked when option_id is NULL.
    -- Value type vs. field data_type is validated by the backend (PRD 10.3).
    CONSTRAINT fk_pfv_option_field FOREIGN KEY (option_id, field_id)
        REFERENCES dbo.field_options(option_id, field_id),
    CONSTRAINT ck_pfv_one_value CHECK (
        (CASE WHEN option_id    IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_text   IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_number IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_date   IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_bool   IS NULL THEN 0 ELSE 1 END) = 1)
);
GO

/* ---------------------------------------------------------------------
   4. Users and authorization grants  (PRD 3.4, 3.6, 3.8, 3.9, 9.1)
   Entra provides identity and app access only. Action permissions are
   stored here in QCH Connect and granted or removed in the app by
   designated QCH administrators (PRD 3.4, 3.8). Who the administrators
   are is configuration, not hard-coded or seeded here.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.users (
    user_id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
    entra_object_id  UNIQUEIDENTIFIER NULL,
    display_name     NVARCHAR(200)    NOT NULL,
    email            NVARCHAR(320)    NOT NULL CONSTRAINT uq_users_email UNIQUE,
    -- The staff member's stored current Program affiliation, chosen by the
    -- staff member (PRD 3.9, 9.1). NULL until chosen; referral submission
    -- fails closed while it is NULL (enforced by the backend). Changing it
    -- never changes past referrals, which keep referrals.referring_program_id.
    -- Changes are audited (audit_events entity USER).
    current_program_id INT            NULL CONSTRAINT fk_users_current_program REFERENCES dbo.programs(program_id),
    is_demo_user     BIT              NOT NULL CONSTRAINT df_users_demo DEFAULT 0,   -- must be rejected in production (PRD 16.1)
    is_active        BIT              NOT NULL CONSTRAINT df_users_active DEFAULT 1,
    created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_users_created DEFAULT SYSUTCDATETIME(),
    row_version      ROWVERSION       NOT NULL,
    CONSTRAINT ck_users_demo_has_no_entra CHECK (is_demo_user = 0 OR entra_object_id IS NULL)
);
GO
/* Plain UNIQUE would allow only ONE user without an Entra ID. Filtered index allows many. */
CREATE UNIQUE INDEX ux_users_entra_object_id ON dbo.users(entra_object_id) WHERE entra_object_id IS NOT NULL;
GO

CREATE TABLE dbo.user_grants (
    grant_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_user_grants PRIMARY KEY,
    user_id          INT           NOT NULL CONSTRAINT fk_user_grants_user REFERENCES dbo.users(user_id),
    permission       NVARCHAR(40)  NOT NULL,
    scope_type       NVARCHAR(20)  NOT NULL,
    department_id    INT           NULL CONSTRAINT fk_user_grants_department REFERENCES dbo.departments(department_id),
    program_id       INT           NULL CONSTRAINT fk_user_grants_program REFERENCES dbo.programs(program_id),
    grant_source     NVARCHAR(20)  NOT NULL,
    granted_at       DATETIME2(3)  NOT NULL CONSTRAINT df_user_grants_granted DEFAULT SYSUTCDATETIME(),
    revoked_at       DATETIME2(3)  NULL,
    -- Capability names are the PRD 3.6 list, word for word. Notes:
    -- - UPDATE_RECEIVED_REFERRAL includes authorized correction of the
    --   Response/Decision. CORRECT_OUTCOME covers the Service Outcome only.
    -- - ADMINISTER_PERMISSIONS authorizes permission administration only.
    -- - CREATE_REFERRAL and VIEW_AGGREGATE_REPORTING are NOT grantable:
    --   every user with app access has them, so they never depend on a row
    --   in this table (PRD 3.6). The backend checks app access for those two.
    CONSTRAINT ck_user_grants_permission CHECK (permission IN
        ('VIEW_CREATED_REFERRAL','VIEW_RECEIVED_REFERRAL','RESPOND_TO_REFERRAL',
         'UPDATE_RECEIVED_REFERRAL','RECORD_OUTCOME','CORRECT_OUTCOME',
         'MANAGE_PROGRAM','MANAGE_ORGANIZATION','VIEW_UNDERLYING_REFERRAL',
         'ADMINISTER_PERMISSIONS')),
    -- IN_APP: granted or removed in QCH Connect by a QCH administrator (PRD 3.8).
    -- DEMO: non-production only; must be rejected in production (PRD 16.1).
    CONSTRAINT ck_user_grants_source CHECK (grant_source IN ('IN_APP','DEMO')),
    CONSTRAINT ck_user_grants_scope CHECK (
           (scope_type = 'ORG'        AND department_id IS NULL     AND program_id IS NULL)
        OR (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL AND program_id IS NULL)
        OR (scope_type = 'PROGRAM'    AND department_id IS NULL     AND program_id IS NOT NULL)),
    CONSTRAINT ck_user_grants_revoked CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
GO
CREATE INDEX ix_user_grants_active ON dbo.user_grants(user_id, permission) INCLUDE (scope_type, department_id, program_id) WHERE revoked_at IS NULL;
GO

/* ---------------------------------------------------------------------
   5. Not Appropriate reasons  (PRD 9.1)
   Controlled vocabulary. A standard reason is required for Not
   Appropriate; the free-text explanation is separate and optional
   (requires_explanation defaults to 0) unless QCH later directs
   otherwise. The initial values are seeded in 002.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.not_appropriate_reasons (
    reason_id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_not_appropriate_reasons PRIMARY KEY,
    code                  NVARCHAR(50)  NOT NULL CONSTRAINT uq_not_appropriate_reasons_code UNIQUE,
    label                 NVARCHAR(200) NOT NULL,
    requires_explanation  BIT           NOT NULL CONSTRAINT df_nar_requires DEFAULT 0,
    display_order         INT           NOT NULL CONSTRAINT df_nar_order DEFAULT 0,
    lifecycle_status      NVARCHAR(20)  NOT NULL CONSTRAINT df_nar_status DEFAULT 'ACTIVE',
    CONSTRAINT ck_nar_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED'))
);
GO

/* ---------------------------------------------------------------------
   6. GPME rule versions and evaluation context  (PRD 8.7, 9.1)
   Only stored for COMPLETED GPME-assisted referrals. Matching INPUTS
   (age, ZIP, etc.) are never stored here (PRD 5.3). Explanations must be
   written from program facts, e.g. "Serves ages 18 to 24", never from
   participant values.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.gpme_rule_versions (
    rule_version_id  INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_gpme_rule_versions PRIMARY KEY,
    version_label    NVARCHAR(50)  NOT NULL CONSTRAINT uq_gpme_rule_versions_label UNIQUE,
    description      NVARCHAR(1000) NULL,
    activated_at     DATETIME2(3)  NULL,
    retired_at       DATETIME2(3)  NULL
);
GO

CREATE TABLE dbo.gpme_evaluations (
    evaluation_id    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_gpme_evaluations PRIMARY KEY,
    rule_version_id  INT          NOT NULL CONSTRAINT fk_gpme_evaluations_rule REFERENCES dbo.gpme_rule_versions(rule_version_id),
    evaluated_at     DATETIME2(3) NOT NULL CONSTRAINT df_gpme_evaluations_at DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.gpme_evaluation_results (
    evaluation_id          BIGINT         NOT NULL CONSTRAINT fk_gpme_results_evaluation REFERENCES dbo.gpme_evaluations(evaluation_id),
    program_id             INT            NOT NULL CONSTRAINT fk_gpme_results_program REFERENCES dbo.programs(program_id),
    display_order          INT            NOT NULL,
    explanation            NVARCHAR(1000) NOT NULL,
    program_context_json   NVARCHAR(MAX)  NULL,   -- program facts used at recommendation time
    was_selected           BIT            NOT NULL CONSTRAINT df_gpme_results_selected DEFAULT 0,
    CONSTRAINT pk_gpme_evaluation_results PRIMARY KEY (evaluation_id, program_id),
    CONSTRAINT ck_gpme_results_json CHECK (program_context_json IS NULL OR ISJSON(program_context_json) = 1)
);
GO

/* ---------------------------------------------------------------------
   7. Referrals  (PRD 5.1, 5.2, 6.1 to 6.5, 7.3, 9.1)
   Three separate state dimensions: response, decision, service outcome.
   There is no CLOSED state; completion is derived (PRD 6.5).
   --------------------------------------------------------------------- */
CREATE TABLE dbo.referrals (
    referral_id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_referrals PRIMARY KEY,
    submission_id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT uq_referrals_submission UNIQUE,  -- idempotency (PRD 7.3)
    source                       NVARCHAR(20)   NOT NULL,
    gpme_evaluation_id           BIGINT         NULL CONSTRAINT fk_referrals_gpme REFERENCES dbo.gpme_evaluations(evaluation_id),
    created_by_user_id           INT            NOT NULL CONSTRAINT fk_referrals_created_by REFERENCES dbo.users(user_id),

    -- Permanent original routing and historical department context (PRD 9.1, 12.4)
    referring_program_id         INT            NOT NULL CONSTRAINT fk_referrals_referring_program REFERENCES dbo.programs(program_id),
    receiving_program_id         INT            NOT NULL CONSTRAINT fk_referrals_receiving_program REFERENCES dbo.programs(program_id),
    referring_department_id      INT            NOT NULL CONSTRAINT fk_referrals_referring_dept REFERENCES dbo.departments(department_id),
    receiving_department_id      INT            NOT NULL CONSTRAINT fk_referrals_receiving_dept REFERENCES dbo.departments(department_id),

    -- Minimal participant information (PRD 5.2). No DOB, SSN, or address.
    participant_name             NVARCHAR(200)  NOT NULL,
    contact_method               NVARCHAR(20)   NOT NULL,
    contact_value                NVARCHAR(320)  NULL,
    participant_zip              CHAR(5)        NULL,
    referral_context             NVARCHAR(4000) NOT NULL,   -- sensitive: never logged (PRD 5.4)
    notes                        NVARCHAR(4000) NULL,       -- sensitive; bold/italic only, sanitized by backend

    -- Lifecycle (PRD 6.1)
    response_status              NVARCHAR(20)   NOT NULL CONSTRAINT df_referrals_response DEFAULT 'AWAITING_RESPONSE',
    decision                     NVARCHAR(20)   NULL,
    service_outcome              NVARCHAR(30)   NOT NULL CONSTRAINT df_referrals_outcome DEFAULT 'NOT_RECORDED',
    not_appropriate_reason_id    INT            NULL CONSTRAINT fk_referrals_reason REFERENCES dbo.not_appropriate_reasons(reason_id),
    not_appropriate_explanation  NVARCHAR(1000) NULL,
    responded_by_user_id         INT            NULL CONSTRAINT fk_referrals_responded_by REFERENCES dbo.users(user_id),
    outcome_recorded_by_user_id  INT            NULL CONSTRAINT fk_referrals_outcome_by REFERENCES dbo.users(user_id),

    -- Timestamps (UTC). "first_" values are never rewritten by corrections (PRD 12.4).
    created_at                   DATETIME2(3)   NOT NULL CONSTRAINT df_referrals_created DEFAULT SYSUTCDATETIME(),
    first_responded_at           DATETIME2(3)   NULL,
    first_resulted_in_service_at DATETIME2(3)   NULL,
    outcome_recorded_at          DATETIME2(3)   NULL,
    updated_at                   DATETIME2(3)   NOT NULL CONSTRAINT df_referrals_updated DEFAULT SYSUTCDATETIME(),
    row_version                  ROWVERSION     NOT NULL,

    CONSTRAINT ck_referrals_source CHECK (source IN ('DIRECT','GPME_ASSISTED')),
    CONSTRAINT ck_referrals_source_gpme CHECK (
           (source = 'DIRECT'        AND gpme_evaluation_id IS NULL)
        OR (source = 'GPME_ASSISTED' AND gpme_evaluation_id IS NOT NULL)),
    CONSTRAINT ck_referrals_contact_method CHECK (contact_method IN ('PHONE_CALL','PHONE_TEXT','EMAIL','NOT_AVAILABLE')),
    CONSTRAINT ck_referrals_contact_value CHECK (
           (contact_method = 'NOT_AVAILABLE'  AND contact_value IS NULL)
        OR (contact_method <> 'NOT_AVAILABLE' AND contact_value IS NOT NULL)),
    CONSTRAINT ck_referrals_zip CHECK (participant_zip IS NULL OR participant_zip LIKE '[0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT ck_referrals_response CHECK (response_status IN ('AWAITING_RESPONSE','RESPONDED')),
    CONSTRAINT ck_referrals_decision CHECK (decision IS NULL OR decision IN ('ACCEPTED','NOT_APPROPRIATE')),
    CONSTRAINT ck_referrals_outcome CHECK (service_outcome IN ('NOT_RECORDED','RESULTED_IN_SERVICE','DID_NOT_RESULT_IN_SERVICE')),
    -- Awaiting has no decision; Responded always has one (PRD 6.2)
    CONSTRAINT ck_referrals_response_decision CHECK (
           (response_status = 'AWAITING_RESPONSE' AND decision IS NULL     AND first_responded_at IS NULL)
        OR (response_status = 'RESPONDED'         AND decision IS NOT NULL AND first_responded_at IS NOT NULL)),
    -- NOTE: a CHECK passes when it evaluates to NULL, so every comparison
    -- on the nullable "decision" column is guarded with IS NOT NULL.
    -- Not Appropriate requires a standard reason; other decisions have none
    CONSTRAINT ck_referrals_reason CHECK (
           (decision IS NOT NULL AND decision = 'NOT_APPROPRIATE' AND not_appropriate_reason_id IS NOT NULL)
        OR ((decision IS NULL OR decision <> 'NOT_APPROPRIATE') AND not_appropriate_reason_id IS NULL AND not_appropriate_explanation IS NULL)),
    -- Service outcome only after Accepted (PRD 6.5)
    CONSTRAINT ck_referrals_outcome_needs_accept CHECK (
           service_outcome = 'NOT_RECORDED'
        OR (decision IS NOT NULL AND decision = 'ACCEPTED')),
    CONSTRAINT ck_referrals_outcome_recorded CHECK (
           (service_outcome = 'NOT_RECORDED'  AND outcome_recorded_at IS NULL)
        OR (service_outcome <> 'NOT_RECORDED' AND outcome_recorded_at IS NOT NULL)),
    CONSTRAINT ck_referrals_service_time CHECK (service_outcome <> 'RESULTED_IN_SERVICE' OR first_resulted_in_service_at IS NOT NULL),
    CONSTRAINT ck_referrals_time_order CHECK (
        (first_responded_at IS NULL OR first_responded_at >= created_at)
        AND (first_resulted_in_service_at IS NULL OR first_resulted_in_service_at >= created_at))
);
GO
/* One referral per GPME evaluation */
CREATE UNIQUE INDEX ux_referrals_gpme_evaluation ON dbo.referrals(gpme_evaluation_id) WHERE gpme_evaluation_id IS NOT NULL;
GO
/* Indexes for the screens and reports we know we need (PRD 9.9) */
CREATE INDEX ix_referrals_inbox        ON dbo.referrals(receiving_program_id, response_status, created_at);
CREATE INDEX ix_referrals_my_sent      ON dbo.referrals(created_by_user_id, created_at);
CREATE INDEX ix_referrals_report_made  ON dbo.referrals(referring_program_id, created_at);
CREATE INDEX ix_referrals_report_recv  ON dbo.referrals(receiving_program_id, created_at);
CREATE INDEX ix_referrals_created      ON dbo.referrals(created_at);
GO

/* Committed referrals are not hard-deleted (PRD 6.5). Use audited corrections. */
CREATE TRIGGER dbo.trg_referrals_no_delete ON dbo.referrals
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51001, 'Referrals cannot be deleted. Use an audited correction.', 1;
END;
GO

/* Answers to program-specific referral-form fields keep the field/option
   identity they were collected under (PRD 9.1). */
CREATE TABLE dbo.referral_field_values (
    value_id      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_referral_field_values PRIMARY KEY,
    referral_id   BIGINT         NOT NULL CONSTRAINT fk_rfv_referral REFERENCES dbo.referrals(referral_id),
    field_id      INT            NOT NULL CONSTRAINT fk_rfv_field REFERENCES dbo.field_definitions(field_id),
    option_id     INT            NULL,
    value_text    NVARCHAR(2000) NULL,
    value_number  DECIMAL(18,4)  NULL,
    value_date    DATE           NULL,
    value_bool    BIT            NULL,
    CONSTRAINT uq_rfv UNIQUE (referral_id, field_id, option_id),
    CONSTRAINT fk_rfv_option_field FOREIGN KEY (option_id, field_id)
        REFERENCES dbo.field_options(option_id, field_id),
    CONSTRAINT ck_rfv_one_value CHECK (
        (CASE WHEN option_id    IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_text   IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_number IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_date   IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value_bool   IS NULL THEN 0 ELSE 1 END) = 1)
);
GO

/* ---------------------------------------------------------------------
   8. Notification delivery  (PRD 11.4 to 11.6)
   Separate from the referral transaction. No message bodies, no PII,
   no recipient address (it comes from program config).
   --------------------------------------------------------------------- */
CREATE TABLE dbo.notification_deliveries (
    delivery_id        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_notification_deliveries PRIMARY KEY,
    referral_id        BIGINT        NOT NULL CONSTRAINT fk_notifications_referral REFERENCES dbo.referrals(referral_id),
    notification_type  NVARCHAR(30)  NOT NULL CONSTRAINT df_notifications_type DEFAULT 'NEW_REFERRAL',
    status             NVARCHAR(10)  NOT NULL CONSTRAINT df_notifications_status DEFAULT 'PENDING',
    attempt_count      INT           NOT NULL CONSTRAINT df_notifications_attempts DEFAULT 0,
    last_attempt_at    DATETIME2(3)  NULL,
    sent_at            DATETIME2(3)  NULL,
    failure_category   NVARCHAR(100) NULL,   -- e.g. GRAPH_THROTTLED, GRAPH_AUTH_FAILED; never message content
    correlation_id     NVARCHAR(64)  NULL,
    created_at         DATETIME2(3)  NOT NULL CONSTRAINT df_notifications_created DEFAULT SYSUTCDATETIME(),
    row_version        ROWVERSION    NOT NULL,
    CONSTRAINT uq_notifications_referral_type UNIQUE (referral_id, notification_type),   -- duplicate-safe
    CONSTRAINT ck_notifications_type CHECK (notification_type IN ('NEW_REFERRAL')),
    CONSTRAINT ck_notifications_status CHECK (status IN ('PENDING','SENT','FAILED')),
    CONSTRAINT ck_notifications_sent CHECK ((status = 'SENT' AND sent_at IS NOT NULL) OR (status <> 'SENT' AND sent_at IS NULL)),
    CONSTRAINT ck_notifications_attempts CHECK (attempt_count >= 0)
);
GO
CREATE INDEX ix_notifications_status ON dbo.notification_deliveries(status, last_attempt_at);
GO

/* ---------------------------------------------------------------------
   9. Audit events  (PRD 6.5, 9.6)
   Append-only. Covers referral lifecycle and administrative changes.
   Keep before/after JSON to the minimum needed; do not copy referral
   context or notes unless that field is the thing being corrected.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.audit_events (
    audit_event_id  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_audit_events PRIMARY KEY,
    entity_type     NVARCHAR(30)  NOT NULL,
    entity_id       BIGINT        NOT NULL,
    action          NVARCHAR(40)  NOT NULL,
    actor_user_id   INT           NOT NULL CONSTRAINT fk_audit_actor REFERENCES dbo.users(user_id),
    occurred_at     DATETIME2(3)  NOT NULL CONSTRAINT df_audit_occurred DEFAULT SYSUTCDATETIME(),
    before_json     NVARCHAR(MAX) NULL,
    after_json      NVARCHAR(MAX) NULL,
    correlation_id  NVARCHAR(64)  NULL,
    CONSTRAINT ck_audit_entity CHECK (entity_type IN
        ('REFERRAL','PROGRAM','DEPARTMENT','FIELD','FIELD_OPTION','PROGRAM_FIELD','USER','USER_GRANT','REASON','GPME_RULE')),
    CONSTRAINT ck_audit_action CHECK (action IN
        ('CREATED','UPDATED','RENAMED','ACCEPTED','NOT_APPROPRIATE','SERVICE_OUTCOME_RECORDED','CORRECTED',
         'DISCONTINUED','REACTIVATED','RETIRED','REPLACED','GRANTED','REVOKED','ACTIVATED')),
    CONSTRAINT ck_audit_before_json CHECK (before_json IS NULL OR ISJSON(before_json) = 1),
    CONSTRAINT ck_audit_after_json  CHECK (after_json  IS NULL OR ISJSON(after_json)  = 1)
);
GO
CREATE INDEX ix_audit_entity ON dbo.audit_events(entity_type, entity_id, occurred_at);
GO

CREATE TRIGGER dbo.trg_audit_events_append_only ON dbo.audit_events
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51000, 'audit_events is append-only.', 1;
END;
GO
