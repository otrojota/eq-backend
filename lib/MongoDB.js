import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL;
const MONGO_DATABASE = process.env.MONGO_DATABASE;

class MongoDB {
    static get instance() {
        if (MongoDB._singleton) return MongoDB._singleton;
        if (!MONGO_URL || !MONGO_DATABASE) throw "MongoDB: No hay parámetros de conexión en las variables de entorno (MONGO_URL, MONGO_DATABASE)";
        MongoDB._singleton = new MongoDB(MONGO_URL, MONGO_DATABASE);
        return MongoDB._singleton;
    }

    constructor(url, database) {
        this.client = null;

        this.databaseURL = url;
        this.databaseName = database;

        this.db = null;        
    }
    get connected() {return this.client?true:false}

    uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async init() {
        try {
            this.client = new MongoClient(this.databaseURL, {});
            await this.client.connect();
            this.db = this.client.db(this.databaseName); 
        } catch(error) {
            console.error("[MongoDB] Cannot connect to Database '" + this.databaseName + "'");
            console.error(error);            
        }        
    }

    isInitialized() {return this.db?true:false}

    async collection(name) {
        try {
            if (!this.db) throw "MongoDB No Inicializado";
            return this.db.collection(name);
        } catch (error) {
            throw error;
        }
    }
}

export default MongoDB.instance;