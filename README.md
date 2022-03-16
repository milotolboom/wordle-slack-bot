
# Migrating the database 🛫
Run a local instance of postgres, which is used as a shadow database.

```bash
docker run -d --rm -P -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD="thecranegame" --name postgres-wordle postgres:alpine
```



