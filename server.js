const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Serve frontend files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.log('MongoDB connection error:', err));

// Define the Student schema
const studentSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    dob: Date,
    college: String,
    department: String,
    gender: String,
    cgpa: { type: Number, default: null },
    username: { type: String, unique: true, sparse: true },
    password: String,
    googleId: { type: String, unique: true, sparse: true },
    picture: String,
    resumeData: { type: mongoose.Schema.Types.Mixed, default: null },
    resumePdf: { type: String, default: null },
});

// Create the Student model
const Student = mongoose.model('Student', studentSchema);

// Define the Admin schema
const adminSchema = new mongoose.Schema({
    name: String,
    position: String,
    email: String,
    phone: String,
    username: { type: String, unique: true },
    password: String, // The password will be hashed
});

// Create the Admin model
const Admin = mongoose.model('Admin', adminSchema);

// Define the Announcement schema
const announcementSchema = new mongoose.Schema({
    title: String,
    content: String,
    createdAt: { type: Date, default: Date.now },
});

// Create the Announcement model
const Announcement = mongoose.model('Announcement', announcementSchema);

// Define the Company schema
const companySchema = new mongoose.Schema({
    name: String,
    email: String,
    company_add: String,
    phone: String,
    username: { type: String, unique: true },
    password: String, // The password will be hashed
});

// Create the Company model
const Company = mongoose.model('Company', companySchema);

// Create an announcement (Admin only)
app.post('/announcements', async (req, res) => {
    try {
        const { title, content } = req.body;
        const newAnnouncement = new Announcement({ title, content });
        await newAnnouncement.save();
        res.status(201).json({ message: 'Announcement created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating announcement', error });
    }
});

// Get all announcements for students and admins
app.get('/announcements', async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ createdAt: -1 });
        res.status(200).json(announcements);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching announcements', error });
    }
});

// DELETE an announcement by ID (Admin only)
app.delete('/announcements/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deletedAnnouncement = await Announcement.findByIdAndDelete(id);

        if (!deletedAnnouncement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        res.status(200).json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting announcement', error });
    }
});

// Google OAuth — verify token and find/create student
app.post('/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!GOOGLE_CLIENT_ID) {
            return res.status(500).json({ message: 'Google Client ID not configured on server.' });
        }
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const { sub: googleId, email, name, picture } = ticket.getPayload();

        // Find existing student by googleId or email
        let student = await Student.findOne({ $or: [{ googleId }, { email }] });

        if (student) {
            if (!student.googleId) {
                student.googleId = googleId;
                student.picture = picture;
                await student.save();
            }
            return res.status(200).json({
                message: 'Login successful',
                isNewUser: false,
                user: {
                    name: student.name,
                    email: student.email,
                    username: student.username,
                    department: student.department,
                    picture: student.picture || picture,
                }
            });
        }

        // New Google user — profile completion required
        return res.status(200).json({
            message: 'Profile completion required',
            isNewUser: true,
            user: { name, email, googleId, picture }
        });
    } catch (error) {
        res.status(401).json({ message: 'Google sign-in failed. Please try again.', error: error.message });
    }
});

// Google OAuth — complete profile for new Google users
app.post('/auth/google/complete', async (req, res) => {
    try {
        const { googleId, name, email, phone, dob, college, department, gender, username, picture } = req.body;

        const existing = await Student.findOne({ username });
        if (existing) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const newStudent = new Student({
            name, email, phone, dob, college, department, gender,
            username, googleId, picture, password: null,
        });
        await newStudent.save();

        res.status(201).json({
            message: 'Registration successful',
            user: { name, email, username, department, picture }
        });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error completing registration', error });
        }
    }
});

// Student Registration Route
app.post('/register', async (req, res) => {
    try {
        const { name, email, phone, dob, college, department, gender, username, password } = req.body;

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        const newStudent = new Student({
            name,
            email,
            phone,
            dob,
            college,
            department,
            gender,  // Make sure gender is included in the body
            username,
            password: hashedPassword, // Save the hashed password
        });

        await newStudent.save();
        res.status(201).json({ message: 'Student registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Student Login Route
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await Student.findOne({ username });

        if (!user) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Login successful',
            user: {
                name: user.name,
                username: user.username,
                email: user.email,
                department: user.department,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Admin Registration Route
app.post('/admin/register', async (req, res) => {
    try {
        const { name, position, email, phone, username, password } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = new Admin({
            name,
            position,
            email,
            phone,
            username,
            password: hashedPassword,
        });

        await newAdmin.save();
        res.status(201).json({ message: 'Admin registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Admin Login Route
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, admin.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Admin login successful',
            admin: {
                name: admin.name,
                username: admin.username,
                position: admin.position,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Student Profile Route
app.get('/student/profile', async (req, res) => {
    try {
        const { username } = req.query;
        const student = await Student.findOne({ username });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.status(200).json({
            username: student.username,
            name: student.name,
            email: student.email,
            phone: student.phone,
            department: student.department,
            college: student.college,
            gender: student.gender,
            cgpa: student.cgpa ?? null,
            hasResume: !!(student.resumeData || student.resumePdf),
            resumePdf: student.resumePdf || null,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching student profile', error });
    }
});

// Student Update Route
app.put('/student/update', async (req, res) => {
    const { username, name, email, phone, department, college, gender, cgpa } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    const update = { name, email, phone, department, college, gender };
    if (cgpa !== undefined && cgpa !== null && cgpa !== '') {
        const parsed = parseFloat(cgpa);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 10) update.cgpa = parsed;
    } else if (cgpa === '' || cgpa === null) {
        update.cgpa = null;
    }
    try {
        const updatedStudent = await Student.findOneAndUpdate(
            { username },
            update,
            { new: true }
        );
        if (!updatedStudent) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating student profile', error });
    }
});

// Admin Profile Route
app.get('/admin/profile', async (req, res) => {
    try {
        const { username } = req.query; // Expect username in query parameters
        
        // Find the admin by username
        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Return admin profile details (excluding password)
        res.status(200).json({
            username: admin.username,
            name: admin.name,
            email: admin.email,
            phone: admin.phone,
            position: admin.position
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching admin profile', error });
    }
});

// Admin Update Route
app.put('/admin/update', async (req, res) => {
    const { username, name, email, phone, position } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    try {
        const updatedAdmin = await Admin.findOneAndUpdate(
            { username },
            { name, email, phone, position },
            { new: true }
        );
        if (!updatedAdmin) {
            return res.status(404).json({ message: 'Admin not found' });
        }
        res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating admin profile', error });
    }
});

// Get total count of students route
app.get('/students/count', async (req, res) => {
    try {
        const count = await Student.countDocuments(); // Get the count of documents in the collection
        res.status(200).json({ count });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching student count', error });
    }
});

// Get all students route (if you still want to display details later)
app.get('/students', async (req, res) => {
    try {
        const students = await Student.find({});
        res.status(200).json(students);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching students', error });
    }
});

// DELETE a student by username
app.delete('/students/:username', async (req, res) => {
    const username = req.params.username;
    try {
        const deletedStudent = await Student.findOneAndDelete({ username });
        if (deletedStudent) {
            res.json({ message: 'Student deleted successfully' });
        } else {
            res.status(404).json({ message: 'Student not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Update student details
app.put('/students/:username', async (req, res) => {
    const username = req.params.username;
    const { name, email, phone, gender, department } = req.body;

    if (!name || !email || !phone) {
        return res.status(400).json({ message: 'All fields (name, email, phone) are required' });
    }

    const updateFields = { name, email, phone, gender };
    if (department !== undefined) updateFields.department = department;

    try {
        const updatedStudent = await Student.findOneAndUpdate(
            { username },
            updateFields,
            { new: true }
        );

        if (updatedStudent) {
            res.json(updatedStudent); // Respond with updated student details
        } else {
            res.status(404).json({ message: 'Student not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error during student update', error: err.message });
    }
});

// Save student resume data
app.put('/students/:username/resume', async (req, res) => {
    try {
        const { resumeData, cgpa } = req.body;
        const update = { resumeData };
        if (cgpa !== undefined && cgpa !== null && cgpa !== '') update.cgpa = parseFloat(cgpa);
        const student = await Student.findOneAndUpdate(
            { username: req.params.username },
            update,
            { new: true }
        );
        if (!student) return res.status(404).json({ message: 'Student not found' });
        res.json({ message: 'Resume saved successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error saving resume', error: err.message });
    }
});

// Get student resume data
app.get('/students/:username/resume', async (req, res) => {
    try {
        const student = await Student.findOne({ username: req.params.username }, 'resumeData resumePdf name');
        if (!student) return res.status(404).json({ message: 'Student not found' });
        res.json({ resumeData: student.resumeData, resumePdf: student.resumePdf || null, name: student.name });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching resume', error: err.message });
    }
});

// PDF resume upload — use /tmp on serverless (Vercel), local uploads/ otherwise
const uploadsDir = process.env.VERCEL
    ? path.join('/tmp', 'resumes')
    : path.join(__dirname, 'uploads', 'resumes');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const resumeStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, req.params.username + '_resume.pdf'),
});
const resumeUpload = multer({
    storage: resumeStorage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

app.post('/students/:username/resume/upload', (req, res) => {
    resumeUpload.single('resume')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ message: err.message || 'Upload failed' });
        }
        try {
            const username = req.params.username;
            if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
            const pdfPath = '/uploads/resumes/' + req.file.filename;
            await Student.findOneAndUpdate({ username }, { resumePdf: pdfPath });
            res.json({ message: 'Resume uploaded successfully', path: pdfPath });
        } catch (dbErr) {
            res.status(500).json({ message: dbErr.message || 'Upload failed' });
        }
    });
});

// Serve uploaded resumes
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Company Registration Route
app.post('/company/register', async (req, res) => {
    try {
        const { name, email, company_add, phone, username, password } = req.body;

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        const newCompany = new Company({
            name,
            email,
            company_add,
            phone,
            username,
            password: hashedPassword,
        });

        await newCompany.save();
        res.status(201).json({ message: 'Company registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Company Login Route
app.post('/company/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const company = await Company.findOne({ username });

        if (!company) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, company.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Company login successful',
            company: {
                name: company.name,
                username: company.username,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Company Announcement Route
app.post('/company/announcements', async (req, res) => {
    try {
        const { title, content } = req.body;

        // Assuming company should be authenticated to create an announcement
        const newAnnouncement = new Announcement({ title, content });
        await newAnnouncement.save();
        res.status(201).json({ message: 'Announcement created successfully by company' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating announcement', error });
    }
});

// Export app for Vercel serverless
module.exports = app;

// Start server locally
if (require.main === module) {
    const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} in use — freeing it...`);
            const { exec } = require('child_process');
            exec(
                `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port}" ^| findstr "LISTENING"') do taskkill /F /PID %a`,
                { shell: 'cmd.exe' },
                () => setTimeout(() => server.listen(port), 500)
            );
        } else {
            throw err;
        }
    });
}
