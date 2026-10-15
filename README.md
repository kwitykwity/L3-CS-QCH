# L3-Capstone-QCH

QCH Internal Referral System - L3 Capstone Project

## Database

Database schema and migrations are added through their own reviewed pull
requests, separate from the application scaffold.

Production Azure SQL is owned by QCH and is provided and configured through
QCH IT. Database connection details, credentials, and secrets must never be
committed to this repository. Locally they belong in the gitignored `.env`
file; in production they come from Azure Key Vault (PRD 15.2).