'use strict';

const express = require('express');

const router = express.Router();

// Availability only (PRD 9.12, 15.3). Never include config, versions, paths,
// connection details, or any dependency internals in this response.
router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
