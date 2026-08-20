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
  products = fs.existsSync(dbFile)
    ? JSON.parse(fs.readFileSync(dbFile, "utf8"))
    : [];
} catch (err) {
  console.error("Could not read products.json:", err);
  products = [];
}

function save() {
  fs.writeFileSync(dbFile, JSON.stringify(products, null, 2));
}

/*
  Upload storage
*/
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),

  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});

/*
  Accept preview images + TIFF/TIF/ZIP digital files.
  We check BOTH MIME type and file extension because Android/browser
  uploads sometimes send TIFF files as application/octet-stream.
*/
const allowedImageExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const allowedDigitalExt = new Set([
  ".tif",
  ".tiff",
  ".zip"
]);

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    const isImage =
      allowedImageExt.has(ext) ||
      /^(image\/jpeg|image\/png|image\/webp)$/i.test(file.mimetype);

    const isDigital =
      allowedDigitalExt.has(ext) ||
      /^(image\/tiff|application\/zip|application\/x-zip-compressed|application\/octet-stream)$/i.test(
        file.mimetype
      );

    if (isImage || isDigital) {
      return cb(null, true);
    }

    cb(new Error("Unsupported file type. Use JPG, PNG, WEBP, TIFF/TIF or ZIP."));
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
      secure: process.env.NODE_ENV === "production"
    }
  })
);

/*
  Serve the website.
*/
app.use(express.static(__dirname));

/*
  IMPORTANT: fixes "Cannot GET /"
*/
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/*
  Preview images are public.
  Digital files are NOT served from /uploads directly.
*/
app.use("/uploads", express.static(uploadDir));

function auth(req, res, next) {
  if (req.session.admin) return next();
  return res.status(401).json({ error: "Admin login required" });
}

/*
  Admin login
*/
app.post("/api/login", (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  req.session.admin = true;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ admin: !!req.session.admin });
});

/*
  Public product list
*/
app.get("/api/products", (req, res) => {
  res.json(
    products.map(({ downloadFile, ...safe }) => safe)
  );
});

/*
  Admin: publish product
*/
app.post(
  "/api/products",
  auth,
  upload.fields([
    { name: "preview", maxCount: 1 },
    { name: "digitalFile", maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const { name, price, category, description } = req.body;

      if (!name || !price || !category) {
        return res.status(400).json({
          error: "Name, price and category are required"
        });
      }

      const preview = req.files?.preview?.[0];
      const digital = req.files?.digitalFile?.[0];

      if (!preview || !digital) {
        return res.status(400).json({
          error: "Preview image and digital file are required"
        });
      }

      const product = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        price: Number(price),
        category: String(category).trim(),
        description: String(description || "").trim(),
        previewUrl: "/uploads/" + preview.filename,
        downloadFile: digital.filename,
        createdAt: new Date().toISOString()
      };

      products.push(product);
      save();

      const { downloadFile, ...safe } = product;
      res.json(safe);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not publish product" });
    }
  }
);

/*
  Admin: delete product
*/
app.delete("/api/products/:id", auth, (req, res) => {
  const product = products.find(
    x => x.id === req.params.id
  );

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  for (const file of [product.downloadFile, product.previewUrl]) {
    if (!file) continue;

    const filename = path.basename(
      String(file).replace(/^\/uploads\//, "")
    );

    const fullPath = path.join(uploadDir, filename);

    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      console.error("Could not delete file:", err);
    }
  }

  products = products.filter(
    x => x.id !== req.params.id
  );

  save();
  res.json({ ok: true });
});

/*
  Digital file download.
  This is currently protected by admin auth.
  Payment-gated customer downloads can be added later.
*/
app.get("/api/products/:id/download", auth, (req, res) => {
  const product = products.find(
    x => x.id === req.params.id
  );

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  const filePath = path.join(uploadDir, product.downloadFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Digital file not found" });
  }

  res.download(filePath);
});

/*
  Multer / general error handler
*/
app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.message
    });
  }

  res.status(400).json({
    error: err.message || "Something went wrong"
  });
});

app.listen(PORT, () => {
  console.log(`KP Design Studio running on port ${PORT}`);
});
