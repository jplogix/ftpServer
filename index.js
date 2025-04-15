const { FtpSrv } = require("ftp-srv");
const fs = require("fs");
const path = require("path");
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

// Create a custom logger compatible with ftp-srv requirements
const customLogger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => console.debug(...args),
  trace: (...args) => console.trace(...args),
  warn: (...args) => console.warn(...args),
  // Add the child method that returns the same logger
  child: () => customLogger,
};

// Get a proper IP address for passive mode
let pasvIP = process.env.PUBLIC_IP;
if (!pasvIP) {
  // If PUBLIC_IP isn't set, try to use PASV_URL but validate it first
  const pasvUrl = process.env.PASV_URL || "127.0.0.1";

  // Check if it's a domain name or IP
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(pasvUrl)) {
    // It's already an IP address
    pasvIP = pasvUrl;
  } else {
    // It's a domain, we should use the PUBLIC_IP instead if available
    // For safety, default to a local IP
    console.warn(
      `PASV_URL is a domain (${pasvUrl}), using fallback IP 127.0.0.1`
    );
    console.warn(
      "Please set PUBLIC_IP in your .env file for proper passive mode"
    );
    pasvIP = "127.0.0.1";
  }
}

console.log(`Using passive mode IP: ${pasvIP}`);

// Initialize FTP server
const ftpServer = new FtpSrv({
  url: `ftp://0.0.0.0:${process.env.FTP_PORT || 21}`,
  pasv_url: pasvIP, // Use IP address, not domain name
  pasv_min: process.env.PASV_MIN || 1024,
  pasv_max: process.env.PASV_MAX || 1200, // Match the reduced range in docker-compose
  anonymous: false, // Require authentication
  greeting: "Welcome to Unify Finale Inventory FTP Server",
  blacklist: [], // Don't blacklist any commands
  whitelist: [], // Allow all commands
  file_format: "ls", // Standard format for directory listings
  log: customLogger, // Use our custom logger
});

// File system operations handler
const fileHandler = (ftpClient, fs) => {
  // Track current working directory
  let currentDirectory = "/";
  console.log("Creating file handler for new connection");

  // Check if uploads directory exists and is accessible
  try {
    console.log(`Checking uploads directory: ${uploadsDir}`);
    const stats = fs.statSync(uploadsDir);
    console.log(`Uploads directory exists: ${stats.isDirectory()}`);
    console.log(`Directory permissions: ${stats.mode}`);
    console.log(`Directory contents: ${fs.readdirSync(uploadsDir)}`);
  } catch (error) {
    console.error(`Error accessing uploads directory: ${error}`);
  }

  // Create a custom file system handler with better compatibility
  return {
    get: (filePath) => {
      try {
        console.log(`GET command called for file: ${filePath}`);
        const fullPath = path.join(uploadsDir, filePath);

        // Special handling for directory listing - needed for proper FTP LIST command compatibility
        const stats = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
        if (stats && stats.isDirectory()) {
          console.log(
            `GET received directory path: ${fullPath}, allowing for LIST compatibility`
          );
          // For directories, return a stream with directory listing info
          const listing = fs
            .readdirSync(fullPath)
            .map((file) => {
              try {
                const fileStats = fs.statSync(path.join(fullPath, file));
                return `${
                  fileStats.isDirectory() ? "d" : "-"
                }rw-r--r-- 1 owner group ${
                  fileStats.size
                } ${fileStats.mtime.toDateString()} ${file}\n`;
              } catch (e) {
                return null;
              }
            })
            .filter(Boolean)
            .join("");

          const stream = require("stream");
          const readable = new stream.Readable();
          readable.push(listing);
          readable.push(null); // Indicates end of the stream
          return readable;
        }

        // Normal file handling
        if (!fs.existsSync(fullPath)) {
          console.error(`File not found: ${fullPath}`);
          throw new Error(`File not found: ${filePath}`);
        }

        if (stats && !stats.isFile()) {
          console.error(`Not a file: ${fullPath}`);
          throw new Error(`Not a file: ${filePath}`);
        }

        return fs.createReadStream(fullPath);
      } catch (error) {
        console.error(`Error accessing file ${filePath}:`, error);
        throw error;
      }
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
      try {
        console.log(`LIST command called for path: ${filePath}`);
        // Normalize the path - empty path, ".", and "/" should all list the root directory
        const normalizedPath =
          filePath === "/" || filePath === "" ? "." : filePath;
        const dirPath = path.join(uploadsDir, normalizedPath);

        console.log(`Checking if path exists: ${dirPath}`);
        if (!fs.existsSync(dirPath)) {
          console.log(`Path does not exist, creating directory: ${dirPath}`);
          fs.mkdirSync(dirPath, { recursive: true });
          return []; // Return empty array for the newly created directory
        }

        // Handle path whether it's a file or directory
        const pathStats = fs.statSync(dirPath);

        if (pathStats.isDirectory()) {
          // It's a directory, list its contents
          console.log(`Reading directory: ${dirPath}`);
          const files = fs.readdirSync(dirPath);
          console.log(`Found ${files.length} files/directories`);

          // Always include "." and ".." entries in directory listings
          const results = [
            {
              name: ".",
              type: "d",
              size: pathStats.size,
              mtime: pathStats.mtime,
            },
            {
              name: "..",
              type: "d",
              size: pathStats.size,
              mtime: pathStats.mtime,
            },
          ];

          // Add all files and directories
          for (const file of files) {
            try {
              const fullPath = path.join(dirPath, file);
              const stats = fs.statSync(fullPath);

              results.push({
                name: file,
                type: stats.isDirectory() ? "d" : "-",
                size: stats.size,
                mtime: stats.mtime,
              });
            } catch (fileError) {
              console.error(`Error processing file ${file}:`, fileError);
              // Skip problem files but continue processing others
            }
          }

          return results;
        } else {
          // It's a file, return just that file's info
          console.log(`Path is a file, returning single file info: ${dirPath}`);
          const fileName = path.basename(dirPath);
          return [
            {
              name: fileName,
              type: "-",
              size: pathStats.size,
              mtime: pathStats.mtime,
            },
          ];
        }
      } catch (error) {
        console.error(`Error listing directory ${filePath}:`, error);
        return [];
      }
    },
    chdir: (filePath = ".") => {
      try {
        console.log(`Changing directory to: ${filePath}`);
        const dirPath = path.join(uploadsDir, filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        currentDirectory = filePath;
        return filePath;
      } catch (error) {
        console.error(`Error changing directory to ${filePath}:`, error);
        return currentDirectory;
      }
    },
    // Add PWD support
    currentDirectory: () => {
      console.log(
        `PWD command called, returning current directory: ${currentDirectory}`
      );
      return currentDirectory || "/";
    },
    // Add this to explicitly handle the PWD command
    pwd: () => {
      console.log(
        `Explicit PWD handler called, returning: ${currentDirectory}`
      );
      return { path: currentDirectory };
    },
    // Make sure mkdir is supported
    mkdir: (filePath) => {
      try {
        const dirPath = path.join(uploadsDir, filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        return filePath;
      } catch (error) {
        console.error(`Error creating directory ${filePath}:`, error);
        throw error;
      }
    },
    // Add support for renaming/moving files
    rename: (from, to) => {
      try {
        const fromPath = path.join(uploadsDir, from);
        const toPath = path.join(uploadsDir, to);
        fs.renameSync(fromPath, toPath);
        return toPath;
      } catch (error) {
        console.error(`Error renaming file from ${from} to ${to}:`, error);
        throw error;
      }
    },
    // Add support for removing files
    unlink: (filePath) => {
      try {
        const fullPath = path.join(uploadsDir, filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (error) {
        console.error(`Error removing file ${filePath}:`, error);
        throw error;
      }
    },
    // Add support for removing directories
    rmdir: (filePath) => {
      try {
        const dirPath = path.join(uploadsDir, filePath);
        if (fs.existsSync(dirPath)) {
          fs.rmdirSync(dirPath);
        }
      } catch (error) {
        console.error(`Error removing directory ${filePath}:`, error);
        throw error;
      }
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
