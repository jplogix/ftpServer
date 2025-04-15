const { FtpSrv } = require("ftp-srv");
const fs = require("fs:node");
const path = require("path:node");
const { Pool } = require("pg");
require("dotenv").config();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "finale_inventory",
  password: process.env.DB_PASSWORD || "postgres",
  port: process.env.DB_PORT || 5432,
});

// Initialize FTP server
const ftpServer = new FtpSrv({
  url: `ftp://0.0.0.0:${process.env.FTP_PORT || 21}`,
  pasv_url: process.env.PASV_URL || "127.0.0.1",
  pasv_min: process.env.PASV_MIN || 1024,
  pasv_max: process.env.PASV_MAX || 30000,
  anonymous: false, // Allow anonymous login (can be changed to false for authentication)
  greeting: "Welcome to Unify Finale Inventory FTP Server",
});

// File system operations handler
const fileHandler = (ftpClient, fs) => {
  return {
    get: (filePath) => {
      const fullPath = path.join(uploadsDir, filePath);
      return fs.createReadStream(fullPath);
    },
    put: async (dataStream, filePath) => {
      try {
        console.log(`Incoming file: ${filePath}`);
        const fullPath = path.join(uploadsDir, filePath);
        const dirPath = path.dirname(fullPath);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        // Save the file
        const writeStream = fs.createWriteStream(fullPath);
        await new Promise((resolve, reject) => {
          dataStream.pipe(writeStream);
          dataStream.on("end", () => {
            console.log(`File ${filePath} received and saved`);
            resolve();
          });
          dataStream.on("error", reject);
        });

        // Process the file if it's JSON
        if (path.extname(filePath).toLowerCase() === ".json") {
          processJsonFile(fullPath);
        } else if (path.extname(filePath).toLowerCase() === ".csv") {
          console.log(
            "CSV file detected. You may need to implement CSV parsing."
          );
        }

        return;
      } catch (error) {
        console.error("Error handling file upload:", error);
        throw error;
      }
    },
    list: (filePath = ".") => {
      const dirPath = path.join(uploadsDir, filePath);
      if (!fs.existsSync(dirPath)) {
        return [];
      }

      const files = fs.readdirSync(dirPath);
      return files.map((file) => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);
        return {
          name: file,
          type: stats.isDirectory() ? "d" : "-",
          size: stats.size,
          mtime: stats.mtime,
        };
      });
    },
    chdir: (filePath = ".") => {
      const dirPath = path.join(uploadsDir, filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return dirPath;
    },
  };
};

// Process JSON file and insert into PostgreSQL
async function processJsonFile(filePath) {
  try {
    console.log(`Processing JSON file: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (!Array.isArray(data)) {
      console.log("Expected JSON array for inventory data. Got:", typeof data);
      return;
    }

    console.log(`Found ${data.length} inventory items to process`);

    // Insert data into PostgreSQL
    for (const item of data) {
      try {
        // This is a simplified example - adjust according to your actual data structure
        const query = {
          text: `INSERT INTO inventory_items 
                 (item_id, sku, name, quantity, location, last_updated) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 ON CONFLICT (item_id) 
                 DO UPDATE SET 
                 sku = $2, name = $3, quantity = $4, location = $5, last_updated = $6`,
          values: [
            item.id || item.itemId || item.item_id || null,
            item.sku || null,
            item.name || null,
            item.quantity || 0,
            item.location || null,
            new Date(),
          ],
        };

        await pool.query(query);
      } catch (error) {
        console.error("Error inserting item into database:", error);
        console.error("Item data:", JSON.stringify(item));
      }
    }

    console.log(`Successfully processed ${data.length} items from ${filePath}`);

    // Move the file to a processed folder to avoid reprocessing
    const processedDir = path.join(path.dirname(filePath), "processed");
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newPath = path.join(processedDir, `${timestamp}_${fileName}`);
    fs.renameSync(filePath, newPath);
    console.log(`Moved processed file to ${newPath}`);
  } catch (error) {
    console.error("Error processing JSON file:", error);
  }
}

// FTP server event handlers
ftpServer.on("login", ({ connection, username, password }, resolve, reject) => {
  console.log(`Login attempt: ${username}`);
  // Check credentials against .env values
  if (username === process.env.FTP_USER && password === process.env.FTP_PASS) {
    console.log(`User ${username} successfully authenticated`);
    return resolve({ fs: fileHandler(connection, fs) });
  }
  console.log(`Authentication failed for user: ${username}`);
  return reject(new Error("Invalid username or password"));
});

ftpServer.on("client-error", ({ connection, context, error }) => {
  console.error("Client error:", error);
});

// Start the FTP server
ftpServer
  .listen()
  .then(() => {
    console.log(`FTP server running on port ${process.env.FTP_PORT || 21}`);
    console.log(`Files will be stored in: ${uploadsDir}`);
  })
  .catch((err) => {
    console.error("Error starting FTP server:", err);
  });
