const { Pool } = require("pg");
require("dotenv").config();

async function setupDatabase() {
  console.log("Database connection information:");
  console.log(`Host: ${process.env.DB_HOST || "localhost"}`);
  console.log(`Port: ${process.env.DB_PORT || 5432}`);
  console.log(`User: ${process.env.DB_USER || "postgres"}`);
  console.log(`Database: ${process.env.DB_NAME || "finale_inventory"}`);

  // Check if database exists first
  let skipCreateDB = process.argv.includes("--skip-create-db");

  if (!skipCreateDB) {
    // First, connect to PostgreSQL to create the database if it doesn't exist
    const connectionPool = new Pool({
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: "postgres", // Connect to default postgres database
      password: process.env.DB_PASSWORD || "postgres",
      port: process.env.DB_PORT || 5432,
      connectionTimeoutMillis: 5000, // 5 second timeout
    });

    try {
      // Try to create the database
      console.log(`Attempting to connect to PostgreSQL server...`);
      await connectionPool.query("SELECT NOW()");
      console.log("Connected successfully to PostgreSQL server.");

      console.log(
        `Attempting to create database ${
          process.env.DB_NAME || "finale_inventory"
        }...`
      );
      await connectionPool.query(
        `CREATE DATABASE ${process.env.DB_NAME || "finale_inventory"}`
      );
      console.log("Database created successfully.");
    } catch (error) {
      if (error.code === "42P04") {
        console.log("Database already exists, continuing with setup.");
      } else if (error.code === "ECONNREFUSED") {
        console.error(
          `Connection refused to ${process.env.DB_HOST || "localhost"}:${
            process.env.DB_PORT || 5432
          }.`
        );
        console.error(
          "Please check that the PostgreSQL server is running and accessible."
        );
        console.error(
          "You can try running with --skip-create-db if the database already exists."
        );
        throw error;
      } else {
        console.error("Error connecting to database server:", error);
        console.error(
          "You can try running with --skip-create-db if the database already exists."
        );
        throw error;
      }
    } finally {
      await connectionPool
        .end()
        .catch((err) => console.log("Error closing connection pool:", err));
    }
  } else {
    console.log("Skipping database creation as requested...");
  }

  // Connect to the newly created database to create tables
  console.log(
    `Connecting to database ${
      process.env.DB_NAME || "finale_inventory"
    } to create tables...`
  );

  const dbPool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "finale_inventory",
    password: process.env.DB_PASSWORD || "postgres",
    port: process.env.DB_PORT || 5432,
    connectionTimeoutMillis: 5000, // 5 second timeout
  });

  try {
    // Test the connection first
    await dbPool.query("SELECT NOW()");
    console.log("Connected successfully to database.");

    // Create inventory_items table
    await dbPool.query(`
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
    `);
    console.log("Created inventory_items table.");

    // Create indexes for better query performance
    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location);
    `);
    console.log("Created indexes on inventory_items table.");

    console.log("Database setup completed successfully!");
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error(
        `Connection refused to ${process.env.DB_HOST || "localhost"}:${
          process.env.DB_PORT || 5432
        }.`
      );
      console.error("Please check that:");
      console.error("1. The PostgreSQL server is running and accessible");
      console.error("2. The host and port in your .env file are correct");
      console.error("3. The database user has permission to connect remotely");
      console.error("4. Any firewalls allow the connection");
    } else {
      console.error("Error setting up tables and indexes:", error);
    }
    throw error;
  } finally {
    await dbPool
      .end()
      .catch((err) => console.log("Error closing connection pool:", err));
  }
}

// Run the setup
setupDatabase()
  .then(() => console.log("All done!"))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
