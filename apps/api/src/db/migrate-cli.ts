import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant');
  process.exit(1);
}

migrate(url)
  .then((applied) => {
    console.log(applied.length ? `${applied.length} migration(s) appliquée(s)` : 'Base déjà à jour');
  })
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
