const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_THIS_PASSWORD";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(dataDir, {recursive:true});
fs.mkdirSync(uploadDir, {recursive:true});

const dbFile = path.join(dataDir, "products.json");
let products = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile,"utf8")) : [];

function save(){ fs.writeFileSync(dbFile, JSON.stringify(products,null,2)); }

const storage = multer.diskStorage({
  destination: (_,__,cb)=>cb(null,uploadDir),
  filename: (_,file,cb)=>{
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID()+ext);
  }
});
const upload = multer({
  storage,
  limits:{fileSize: 100*1024*1024},
  fileFilter: (_,file,cb)=>{
    const ok = /image\/(jpeg|png|webp)|application\/zip|image\/tiff/.test(file.mimetype);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  }
});

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production"}
}));
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next){
  if(req.session.admin) return next();
  res.status(401).json({error:"Admin login required"});
}

app.post("/api/login",(req,res)=>{
  if(req.body.password !== ADMIN_PASSWORD) return res.status(401).json({error:"Invalid password"});
  req.session.admin = true;
  res.json({ok:true});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({admin:!!req.session.admin}));

app.get("/api/products",(req,res)=>res.json(products.map(({downloadFile,...p})=>p)));

app.post("/api/products",auth,upload.fields([{name:"preview",maxCount:1},{name:"digitalFile",maxCount:1}]),(req,res)=>{
  const {name,price,category,description} = req.body;
  if(!name || !price || !category) return res.status(400).json({error:"Name, price and category are required"});
  const preview = req.files.preview?.[0];
  const digital = req.files.digitalFile?.[0];
  if(!preview || !digital) return res.status(400).json({error:"Preview image and digital file are required"});
  const product = {
    id: crypto.randomUUID(),
    name, price:Number(price), category, description:description||"",
    previewUrl:"/uploads/"+preview.filename,
    downloadFile:digital.filename,
    createdAt:new Date().toISOString()
  };
  products.push(product); save();
  const {downloadFile,...safe} = product;
  res.json(safe);
});

app.delete("/api/products/:id",auth,(req,res)=>{
  const p=products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:"Not found"});
  for(const f of [p.downloadFile, p.previewUrl?.replace("/uploads/","")]){
    if(f) try{fs.unlinkSync(path.join(uploadDir,f))}catch{}
  }
  products=products.filter(x=>x.id!==p.id); save(); res.json({ok:true});
});

/* Digital files are NOT exposed as a public static directory. */
app.get("/api/products/:id/download",auth,(req,res)=>{
  const p=products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:"Not found"});
  res.download(path.join(uploadDir,p.downloadFile), "KP-Design-"+p.name.replace(/[^a-z0-9]+/gi,"-")+".zip");
});

app.use((err,req,res,next)=>{
  res.status(400).json({error:err.message || "Upload error"});
});

app.listen(PORT,()=>console.log(`KP Design Studio server running on http://localhost:${PORT}`));