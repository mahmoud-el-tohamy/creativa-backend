require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('blacklistentries').find({}).toArray();
  console.log('Total entries:', docs.length);
  console.log(JSON.stringify(docs, null, 2));
  process.exit(0);
}).catch(console.error);
