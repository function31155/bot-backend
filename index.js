const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// API Endpoint for verification
app.post('/api/verify', async (req, res) => {
    const { email, license_key, machine_id } = req.body;

    if (!email || !license_key || !machine_id) {
        return res.status(400).json({ ok: false, reason: "missing_credentials" });
    }

    try {
        // 1. Check if user and key are valid
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND license_key = $2',
            [email, license_key]
        );

        if (userResult.rowCount === 0) {
            return res.json({ ok: false, reason: "invalid_credentials" });
        }

        const user = userResult.rows[0];

        // 2. CHECK EXPIRATION DATE
        const expirationDate = new Date(user.expiration_date);
        const now = new Date();

        if (now > expirationDate) {
            return res.json({ ok: false, reason: "license_expired" });
        }
        // END OF EXPIRATION CHECK

        // 3. Check registered devices for this user
        const devicesResult = await pool.query(
            'SELECT * FROM devices WHERE user_id = $1',
            [user.id]
        );
        const registeredDevices = devicesResult.rows;

        // 4. Check if current machine is already registered
        const isMachineRegistered = registeredDevices.some(device => device.machine_id === machine_id);

        if (isMachineRegistered) {
            // Machine is known, login successful
            return res.json({ 
                ok: true, 
                message: "Login successful.", 
                max_tabs: user.max_tabs,
                expirationDate: user.expiration_date
            });
        }

        // 5. If it's a new machine, check if there is a free slot
        if (registeredDevices.length < user.device_limit) {
            // Add the new machine and login
            await pool.query(
                'INSERT INTO devices(user_id, machine_id) VALUES($1, $2)',
                [user.id, machine_id]
            );
            return res.json({ 
                ok: true, 
                message: "New device registered.", 
                max_tabs: user.max_tabs,
                expirationDate: user.expiration_date
            });
        } else {
            // Device limit reached
            return res.json({ ok: false, reason: "device_limit_reached" });
        }

    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ ok: false, reason: "server_error" });
    }
});

// Add Reset Devices Endpoint
app.post('/api/reset-devices', async (req, res) => {
    const { email, license_key } = req.body;

    if (!email || !license_key) {
        return res.status(400).json({ ok: false, reason: "missing_credentials" });
    }

    try {
        // 1. Verify user credentials first
        const userResult = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND license_key = $2',
            [email, license_key]
        );

        if (userResult.rowCount === 0) {
            return res.json({ ok: false, reason: "invalid_credentials" });
        }

        const user = userResult.rows[0];

        // 2. Delete all devices associated with this user
        await pool.query(
            'DELETE FROM devices WHERE user_id = $1',
            [user.id]
        );

        // 3. Send success response
        res.json({ ok: true, message: "All registered devices have been reset." });

    } catch (error) {
        console.error("Device reset error:", error);
        res.status(500).json({ ok: false, reason: "server_error" });
    }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
