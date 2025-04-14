-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS finale_inventory;

-- Connect to the database
\c finale_inventory;

-- Create inventory_items table
CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    item_id VARCHAR(100) UNIQUE,
    sku VARCHAR(100),
    name VARCHAR(255),
    quantity INTEGER DEFAULT 0,
    location VARCHAR(100),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Add additional fields as needed based on Finale Inventory data structure
    description TEXT,
    category VARCHAR(100),
    supplier VARCHAR(100),
    cost DECIMAL(10, 2),
    price DECIMAL(10, 2),
    
    -- Add any other metadata you might need
    metadata JSONB
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location);