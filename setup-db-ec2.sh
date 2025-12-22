#!/bin/bash

# Update system
sudo yum update -y

# Install PostgreSQL (Amazon Linux 2023 / AL2 compatible)
sudo dnf install postgresql15-server postgresql15 -y
sudo postgresql-setup --initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Configure PostgreSQL to listen on all addresses
# Find postgresql.conf (usually in /var/lib/pgsql/data/ or /var/lib/pgsql/15/data/)
PG_DATA="/var/lib/pgsql/data" 
# If default AL2023 path differs, adjust accordingly. 
# For standard yum install on AL2/AL2023, it's often /var/lib/pgsql/data

# Backup config
sudo cp $PG_DATA/postgresql.conf $PG_DATA/postgresql.conf.bak
sudo cp $PG_DATA/pg_hba.conf $PG_DATA/pg_hba.conf.bak

# Listen on all interfaces
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" $PG_DATA/postgresql.conf

# Allow remote connections (BE CAREFUL: Restrict this to your App EC2 IP in production!)
# Appending to pg_hba.conf
# TYPE  DATABASE        USER            ADDRESS                 METHOD
echo "host    all             all             0.0.0.0/0               md5" | sudo tee -a $PG_DATA/pg_hba.conf

# Restart PostgreSQL
sudo systemctl restart postgresql

# Setup Database and User
# Change 'ecommerce_admin' and 'secure_password' to your desired values
sudo -u postgres psql -c "CREATE DATABASE ecommerce;"
sudo -u postgres psql -c "CREATE USER ecommerce_admin WITH ENCRYPTED PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ecommerce TO ecommerce_admin;"
# In Postgres 15+, public schema permissions might need explicit grant
sudo -u postgres psql -d ecommerce -c "GRANT ALL ON SCHEMA public TO ecommerce_admin;"

echo "PostgreSQL setup complete."
echo "Connection String: postgresql://ecommerce_admin:secure_password@<Public-IP>:5432/ecommerce"
