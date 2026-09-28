import { Pool } from 'pg';
import { hashSecret } from '../auth/secrets';

/**
 * Crée un compte opérateur BACYBRAINS (console).
 * Usage : node dist/db/create-operator.js email@bacybrains.ma "Nom Prénom" motdepasse
 */
async function main(): Promise<void> {
  const [email, fullName, password] = process.argv.slice(2);
  if (!email || !fullName || !password || password.length < 12) {
    console.error('Usage : create-operator <email> <nom> <mot de passe de 12 caractères minimum>');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'operator')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name`,
      [email, await hashSecret(password), fullName],
    );
    console.log(`Opérateur ${email} prêt.`);
  } finally {
    await pool.end();
  }
}

void main();
