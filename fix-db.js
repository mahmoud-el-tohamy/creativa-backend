require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const docs = await db.collection('blacklistentries').find({}).toArray();
  for (const doc of docs) {
    if (!doc.expiresAt) {
      const d = new Date(doc.addedAt);
      d.setMonth(d.getMonth() + 4);
      await db.collection('blacklistentries').updateOne({ _id: doc._id }, { $set: { expiresAt: d } });
    }
  }
  console.log('Fixed missing expiresAt');
  process.exit(0);
}).catch(console.error);
