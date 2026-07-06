import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';

getDb();
console.log('Database initialized at', process.env.DATABASE_PATH ?? './data/githubarchive.db');
