const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_THIS_PASSWORD";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const dbFile = path.join(dataDir, "products.json");

let products = [];

try {
  if (fs.existsSync(dbFile)) {
    products = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    if (!Array.isArray(products)) products = [];
  }
} catch (e) {
  console.error(e);
  products = [];
}

function save() {
  fs.writeFileSync(
    dbFile,
    JSON.stringify(products, null, 2)
  );
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },

  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();

    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp" ||
      file.mimetype === "image/tiff" ||
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed" ||
      /\.(tif|tiff|zip)$/.test(name);

    cb(
      ok ? null : new Error("Unsupported file type"),
      ok
    );
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);

app.use(express.static(__dirname));

function auth(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Admin login required"
  });
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/login", (req, res) => {
  const password = String(req.body.password || "");

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: "Wrong password"
    });
  }

  req.session.admin = true;

  return res.json({
    ok: true
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

app.get("/api/me", (req, res) => {
  res.json({
    admin: !!(req.session && req.session.admin)
  });
});

app.get("/api/products", (_req, res) => {
  res.json(products);
});

const productUpload = upload.fields([
  {
    name: "preview",
    maxCount: 1
  },
  {
    name: "digital",
    maxCount: 1
  },
  {
    name: "digitalFile",
    maxCount: 1
  }
]);

app.post("/api/products", auth, (req, res) => {

  productUpload(req, res, (err) => {

    if (err) {
      console.error("Upload error:", err);

      return res.status(400).json({
        error: err.message || "File upload failed"
      });
    }

    try {

      const {
        name,
        price,
        category,
        description
      } = req.body;

      if (!name || !price || !category) {
        return res.status(400).json({
          error:
            "Name, price and category are required."
        });
      }

      const preview =
        req.files?.preview?.[0];

      const digital =
        req.files?.digital?.[0] ||
        req.files?.digitalFile?.[0];

      if (!preview) {
        return res.status(400).json({
          error: "Preview image is required."
        });
      }

      if (!digital) {
        return res.status(400).json({
          error:
            "TIFF/TIF/ZIP digital file is required."
        });
      }

      const product = {
        id: crypto.randomUUID(),

        name: String(name),

        price: Number(price),

        category: String(category),

        description:
          String(description || ""),

        previewUrl:
          "/uploads/" + preview.filename,

        downloadFile:
          digital.filename,

        createdAt:
          new Date().toISOString()
      };

      products.push(product);

      save();

      const safe = {
        ...product
      };

      delete safe.downloadFile;

      return res.status(201).json(safe);

    } catch (e) {

      console.error(
        "Product creation error:",
        e
      );

      return res.status(500).json({
        error: "Product publish failed."
      });
    }
  });
});

app.delete("/api/products/:id", auth, (req, res) => {

  try {

    const product =
      products.find(
        p => p.id === req.params.id
      );

    if (!product) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    const files = [
      product.downloadFile,
      product.previewUrl
    ];

    for (const file of files) {

      if (!file) continue;

      const filename =
        path.basename(file);

      const fullPath =
        path.join(
          uploadDir,
          filename
        );

      try {

        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }

      } catch (e) {
        console.error(e);
      }
    }

    products =
      products.filter(
        p => p.id !== req.params.id
      );

    save();

    return res.json({
      ok: true
    });

  } catch (e) {

    console.error(e);

    return res.status(500).json({
      error: "Delete failed."
    });
  }
});

app.get(
  "/api/products/:id/download",
  (req, res) => {

    const product =
      products.find(
        p => p.id === req.params.id
      );

    if (!product) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    if (!product.downloadFile) {
      return res.status(404).json({
        error: "Digital file not found"
      });
    }

    const filePath =
      path.join(
        uploadDir,
        path.basename(
          product.downloadFile
        )
      );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Digital file is missing"
      });
    }

    return res.download(filePath);
  }
);

app.use(
  (err, _req, res, _next) => {

    console.error(
      "Unhandled error:",
      err
    );

    if (res.headersSent) return;

    res.status(500).json({
      error:
        err.message || "Server error"
    });
  }
);

app.listen(PORT, () => {

  console.log(
    `KP Design Studio running on port ${PORT}`
  );

});
