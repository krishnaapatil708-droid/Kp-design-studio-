const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT) || 10000;
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
} catch (err) {
  console.error("Could not read products.json:", err);
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
    const ext = path.extname(
      file.originalname || ""
    ).toLowerCase();

    cb(
      null,
      crypto.randomUUID() + ext
    );
  }
});

function isAllowed(file) {
  const name = (
    file.originalname || ""
  ).toLowerCase();

  const ext = path.extname(name);

  if (
    [".tif", ".tiff", ".zip"].includes(ext)
  ) {
    return true;
  }

  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/tiff"
  ].includes(file.mimetype);
}

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (_req, file, cb) => {
    if (isAllowed(file)) {
      return cb(null, true);
    }

    cb(
      new Error(
        "Unsupported file type: " +
        file.originalname
      )
    );
  }
});

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production"
    }
  })
);

app.use(express.static(__dirname));

function auth(req, res, next) {
  if (req.session.admin) {
    return next();
  }

  return res.status(401).json({
    error: "Admin login required."
  });
}

app.post("/api/login", (req, res) => {
  if (
    req.body.password !==
    ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "Wrong password."
    });
  }

  req.session.admin = true;

  res.json({
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
    admin: !!req.session.admin
  });
});

app.get("/api/products", (_req, res) => {
  res.json(products);
});

app.post(
  "/api/products",
  auth,

  upload.fields([
    {
      name: "preview",
      maxCount: 1
    },

    {
      name: "digitalFile",
      maxCount: 1
    },

    {
      name: "digital",
      maxCount: 1
    }
  ]),

  (req, res) => {
    const {
      name,
      price,
      category,
      description
    } = req.body;

    const preview =
      req.files?.preview?.[0];

    const digital =
      req.files?.digitalFile?.[0] ||
      req.files?.digital?.[0];

    if (!name || !price || !category) {
      return res.status(400).json({
        error:
          "Name, price and category are required."
      });
    }

    if (!preview) {
      return res.status(400).json({
        error:
          "Preview image is required."
      });
    }

    if (!digital) {
      return res.status(400).json({
        error:
          "Digital TIFF/TIF/ZIP file is required."
      });
    }

    const product = {
      id: crypto.randomUUID(),

      name: String(name).trim(),

      price: Number(price),

      category:
        String(category).trim(),

      description:
        String(description || "").trim(),

      previewUrl:
        "/uploads/" +
        preview.filename,

      downloadFile:
        digital.filename,

      createdAt:
        new Date().toISOString()
    };

    products.push(product);

    save();

    res.status(201).json(product);
  }
);

app.delete(
  "/api/products/:id",
  auth,

  (req, res) => {
    const product =
      products.find(
        p => p.id === req.params.id
      );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const files = [
      product.downloadFile,

      product.previewUrl
        ?.replace("/uploads/", "")
    ];

    for (const file of files) {
      if (!file) continue;

      const fullPath =
        path.join(
          uploadDir,
          file
        );

      try {
        if (
          fs.existsSync(fullPath)
        ) {
          fs.unlinkSync(fullPath);
        }
      } catch (e) {
        console.error(
          "Could not delete file:",
          e
        );
      }
    }

    products =
      products.filter(
        p => p.id !== req.params.id
      );

    save();

    res.json({
      ok: true
    });
  }
);

app.get(
  "/api/products/:id/download",
  (req, res) => {
    const product =
      products.find(
        p => p.id === req.params.id
      );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const filePath =
      path.join(
        uploadDir,
        product.downloadFile
      );

    if (
      !fs.existsSync(filePath)
    ) {
      return res.status(404).json({
        error:
          "Digital file not found."
      });
    }

    res.download(filePath);
  }
);

app.use(
  (err, _req, res, _next) => {
    console.error(
      "REQUEST ERROR:",
      err
    );

    if (res.headersSent) {
      return;
    }

    const message =
      err?.code ===
      "LIMIT_FILE_SIZE"
        ? "File too large. Maximum size is 100 MB."
        : err?.message ||
          "Server error.";

    res.status(400).json({
      error: message
    });
  }
);

app.get("*", (_req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `KP Design Studio running on port ${PORT}`
    );

    console.log(
      "Your service is live 🎉"
    );
  }
);
