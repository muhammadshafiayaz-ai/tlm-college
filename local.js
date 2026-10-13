// Run on your own computer:  npm start   (needs DATABASE_URL in a .env file or environment)
try { require('dotenv').config(); } catch (e) {}
const app = require('./lib/app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`The Learning Minds school site running at http://localhost:${PORT}`));
