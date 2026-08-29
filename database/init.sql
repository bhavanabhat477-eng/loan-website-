CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY, full_name VARCHAR(150) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE,
  phone VARCHAR(30) NOT NULL, password_hash VARCHAR(255) NOT NULL, date_of_birth VARCHAR(32), gender VARCHAR(50),
  address TEXT, city VARCHAR(150), state VARCHAR(150), pincode VARCHAR(20), employment_type VARCHAR(100),
  company_name VARCHAR(200), monthly_income DECIMAL(15,2), pan VARCHAR(30),
  role ENUM('CLIENT','ADMIN') NOT NULL DEFAULT 'CLIENT', created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(255) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, expires_at VARCHAR(40) NOT NULL,
  INDEX idx_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loan_applications (
  id VARCHAR(64) PRIMARY KEY, application_number VARCHAR(64) NOT NULL UNIQUE, user_id VARCHAR(64) NOT NULL,
  loan_type VARCHAR(100) NOT NULL, loan_amount DECIMAL(15,2) NOT NULL, interest_rate DECIMAL(8,4), tenure INT NOT NULL,
  purpose TEXT NOT NULL, monthly_income DECIMAL(15,2), existing_emi DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('PENDING','DOCUMENT_VERIFICATION','UNDER_REVIEW','APPROVED','REJECTED','DISBURSED','CLOSED') NOT NULL DEFAULT 'PENDING',
  admin_remarks TEXT, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
  INDEX idx_applications_user_created (user_id, created_at),
  INDEX idx_applications_status (status),
  CONSTRAINT fk_applications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS application_documents (
  id VARCHAR(64) PRIMARY KEY, application_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NOT NULL,
  document_type VARCHAR(100) NOT NULL, file_name VARCHAR(255) NOT NULL, file_path VARCHAR(500) NOT NULL,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', admin_remarks TEXT, created_at VARCHAR(40) NOT NULL,
  INDEX idx_documents_application (application_id),
  INDEX idx_documents_user (user_id),
  CONSTRAINT fk_documents_application FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS application_status_history (
  id VARCHAR(64) PRIMARY KEY, application_id VARCHAR(64) NOT NULL, status VARCHAR(30) NOT NULL,
  remarks TEXT, changed_by VARCHAR(64), created_at VARCHAR(40) NOT NULL,
  INDEX idx_history_application_created (application_id, created_at),
  CONSTRAINT fk_history_application FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, application_id VARCHAR(64), title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL, is_read TINYINT(1) NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL,
  INDEX idx_notifications_user_created (user_id, created_at),
  INDEX idx_notifications_application (application_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_application FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
