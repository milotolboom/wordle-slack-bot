# Running 🏃‍♂️
Make sure you have the .env variables set.

**Install dependencies**
```bash
npm i
```

**Start the server**
```bash
npm start
```

# Migrating db after making schema changes 🛫
First, change the `schema.prisma` file.

Before migrating, run a local instance of postgres, which is used as a shadow database for the migration.

```bash
docker run -d --rm -P -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD="thecranegame" --name postgres-wordle postgres:alpine
```

Now run the migration
```bash
npx prisma migrate dev --name name-of-migration-here
```

# Docker install 🐳
Prerequisites:
- cloned project
- .env file with valid credentials
- `docker-compose`
- `docker`

Then run:
```bash
docker-compose build
docker-compose run -d
```

