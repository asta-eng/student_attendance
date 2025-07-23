// Step 1: Install Firebase Admin SDK
// npm install firebase-admin
require('dotenv').config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());
// Serve frontend (index.html, CSS, JS)
app.use(express.static(__dirname + '/public'));



// ✅ Firebase Admin SDK Setup
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});


const firestore = admin.firestore();
const realtimeDb = admin.database();

// ✅ MySQL Connection (Keep existing)
const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "school"
});


db.connect(err => {
  if (err) {
    console.error("❌ Database connection failed:", err);
    return;
  }
  console.log("✅ Connected to MySQL Database");
});

// ✅ Helper function to sync to Firebase
async function syncToFirebase(collection, data, docId = null) {
  try {
    // Sync to Firestore
    if (docId) {
      await firestore.collection(collection).doc(docId.toString()).set(data);
    } else {
      await firestore.collection(collection).add(data);
    }
    
    // Sync to Realtime Database
    if (docId) {
      await realtimeDb.ref(`${collection}/${docId}`).set(data);
    } else {
      await realtimeDb.ref(collection).push(data);
    }
    
    console.log(`✅ Synced to Firebase: ${collection}`);
  } catch (error) {
    console.error("❌ Firebase sync error:", error);
  }
}

// ✅ Helper function to delete from Firebase
async function deleteFromFirebase(collection, docId) {
  try {
    // Delete from Firestore
    await firestore.collection(collection).doc(docId.toString()).delete();
    
    // Delete from Realtime Database
    await realtimeDb.ref(`${collection}/${docId}`).remove();
    
    console.log(`✅ Deleted from Firebase: ${collection}/${docId}`);
  } catch (error) {
    console.error("❌ Firebase delete error:", error);
  }
}

// ✅ GET: All Students (unchanged but with Firebase sync option)
app.get("/students", (req, res) => {
  db.query("SELECT * FROM students", (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    res.json(results);
  });
});

// ✅ POST: Add Student (with Firebase sync)
app.post("/students", async (req, res) => {
  const { id, name, class: studentClass, email } = req.body;
  if (!id || !name || !studentClass)
    return res.status(400).json({ message: "Missing required fields" });

  // Insert into MySQL first
  db.query(
    "INSERT INTO students (id, name, class, email) VALUES (?, ?, ?, ?)",
    [id, name, studentClass, email || null],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "Insert error" });
      
      // Sync to Firebase after successful MySQL insert
      const studentData = {
        id: id,
        name: name,
        class: studentClass,
        email: email || null,
        createdAt: new Date().toISOString()
      };
      
      await syncToFirebase("students", studentData, id);
      
      res.json({ message: "Student added successfully to both MySQL and Firebase" });
    }
  );
});

// ✅ PUT: Update Student (with Firebase sync)
app.put("/students/:id", async (req, res) => {
  const studentId = req.params.id;
  const { name, class: studentClass, email } = req.body;
  
  db.query(
    "UPDATE students SET name=?, class=?, email=? WHERE id=?",
    [name, studentClass, email || null, studentId],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "Update error" });
      
      // Sync update to Firebase
      const updatedData = {
        id: parseInt(studentId),
        name: name,
        class: studentClass,
        email: email || null,
        updatedAt: new Date().toISOString()
      };
      
      await syncToFirebase("students", updatedData, studentId);
      
      res.json({ message: "Student updated successfully in both MySQL and Firebase" });
    }
  );
});

// ✅ DELETE: Student by ID (with Firebase sync)
app.delete("/students/:id", async (req, res) => {
  const studentId = req.params.id;
  
  db.query("DELETE FROM students WHERE id=?", [studentId], async (err, result) => {
    if (err) return res.status(500).json({ message: "Delete error" });
    
    // Delete from Firebase
    await deleteFromFirebase("students", studentId);
    
    res.json({ message: "Student deleted successfully from both MySQL and Firebase" });
  });
});

// ✅ GET: Attendance (unchanged)
app.get("/attendance", (req, res) => {
  db.query("SELECT * FROM attendance", (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    res.json(results);
  });
});

// ✅ POST: Add Attendance (with Firebase sync)
app.post("/attendance", async (req, res) => {
  const { studentId, studentName, studentClass, date, status } = req.body;
  if (!studentId || !date || !status)
    return res.status(400).json({ message: "Missing required fields" });

  db.query(
  "INSERT INTO attendance (student_id, student_name, student_class, date, status) VALUES (?, ?, ?, ?, ?)",
  [studentId, studentName, studentClass, date, status],

    async (err, result) => {
      if (err) return res.status(500).json({ message: "Insert error" });
      
      // Sync attendance to Firebase
      const attendanceData = {
        studentId: studentId,
        studentName: studentName,
        studentClass: studentClass,
        date: date,
        status: status,
        timestamp: new Date().toISOString()
      };
      
      await syncToFirebase("attendance", attendanceData);
      
      res.json({ message: "Attendance recorded successfully in both MySQL and Firebase" });
    }
  );
});

// ✅ NEW: One-time sync existing data to Firebase
app.post("/sync-to-firebase", async (req, res) => {
  try {
    // Sync all students
    db.query("SELECT * FROM students", async (err, students) => {
      if (err) throw err;
      
      for (const student of students) {
        await syncToFirebase("students", {
          id: student.id,
          name: student.name,
          class: student.class,
          email: student.email,
          syncedAt: new Date().toISOString()
        }, student.id);
      }
    });

    // Sync all attendance
    db.query("SELECT * FROM attendance", async (err, attendance) => {
      if (err) throw err;
      
      for (const record of attendance) {
        await syncToFirebase("attendance", {
          id: record.id,
          studentId: record.student_id,
          date: record.date,
          status: record.status,
          syncedAt: new Date().toISOString()
        });
      }
    });

    res.json({ message: "All data synced to Firebase successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Sync failed", error: error.message });
  }
});

// ✅ NEW: Get data from Firebase (for testing)
app.get("/firebase/students", async (req, res) => {
  try {
    const snapshot = await firestore.collection("students").get();
    const students = [];
    snapshot.forEach(doc => {
      students.push({ id: doc.id, ...doc.data() });
    });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: "Firebase fetch error", error: error.message });
  }
});

// ✅ NEW: Real-time listener setup (optional)
function setupRealtimeListeners() {
  // Listen for changes in Firebase and update MySQL if needed
  realtimeDb.ref('students').on('child_changed', (snapshot) => {
    const studentData = snapshot.val();
    const studentId = snapshot.key;
    
    console.log(`🔄 Firebase student updated: ${studentId}`);
    
    // Optional: Update MySQL from Firebase changes
    // db.query("UPDATE students SET name=?, class=?, email=? WHERE id=?", 
    //   [studentData.name, studentData.class, studentData.email, studentId]);
  });
}

// Uncomment to enable real-time sync from Firebase to MySQL
// setupRealtimeListeners();

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📱 Firebase integration enabled`);
  console.log(`🔄 Available endpoints:`);
  console.log(`   POST /sync-to-firebase - Sync existing data to Firebase`);
  console.log(`   GET  /firebase/students - Get students from Firebase`);
});