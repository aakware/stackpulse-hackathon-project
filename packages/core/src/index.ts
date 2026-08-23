import { config } from '@repo/config';
import { test, type DbClient } from '@repo/data';


export const getHomeResponse = () => {
    return {
        message: `Welcome to ${config.app.name}!`,
    };
};

export class TestService {
    constructor(private db: DbClient) {}

    async getAll() {
        return this.db.select().from(test);
    }

    async create(name: string) {
        return this.db.insert(test).values({ name }).returning();
    }
}

