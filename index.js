import express from "express"
import http from "http";
import { ZServer } from "./lib/ZServer.js";
import fs from "fs";
import mongo from "./lib/MongoDB.js";
import temblores from "./lib/Temblores.js";
import eventosAgregados from "./lib/EventosAgregados.js";
import eventosAgregadosPronosticados from "./lib/EventosAgregadosPronosticados.js";
import eventosAgregadosPronosticadosPublicados from "./lib/EventosAgregadosPronosticadosPublicados.js";
import configuracion from "./lib/Configuracion.js";
import "./lib/DescargaTembloresUSGS.js";
import "./lib/ProcesaTembloresDescargados.js";
import "./lib/Clusteriza.js";
import "./lib/EntrenarModelo.js";
import "./lib/EvaluarModelo.js";
import "./lib/GenerarPronostico.js";
import "./lib/GeocodificarPronostico.js";
import "./lib/SincronizarLocalidades.js";
import ejecucionProceso from "./lib/EjecucionProceso.js";
import Scheduller from "./lib/Scheduller.js";

async function createHTTPServer() {
    try {
        await mongo.init();

        const app = express();
        app.use("/", express.static("www"));
        app.use(express.json({ limit: '50mb', extended: false }));
        
        app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, X-API-Key, Authorization");
            res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            next();
        });

        let zServer = new ZServer(app, "/api/v1");

        zServer.registerModule(temblores);
        zServer.registerModule(eventosAgregados);
        zServer.registerModule(eventosAgregadosPronosticados);
        zServer.registerModule(eventosAgregadosPronosticadosPublicados);
        zServer.registerModule(configuracion);
        zServer.registerModule(ejecucionProceso);
        //zServer.registerModule(usuarios);
        let version = "?";
        try {
            let txt = fs.readFileSync("./build.sh").toString();
            txt = txt.split("\n")[0];
            let p = txt.indexOf("=");
            version = txt.substring(p+1);
        } catch(error) {
            console.error(error);
        }

        zServer.oasSetInfo({
            title:"Backend", description:"API de Acceso a Backend", version:version
        });

        if (process.env.API_DOC_PATH) {
            console.log("[Backend] Publicando swagger API doc en " + process.env.API_DOC_PATH);
            await zServer.startSwaggerServer(process.env.API_DOC_PATH);
        }
        if (process.env.OAS_DOC_PATH) app.get(process.env.OAS_DOC_PATH, (req, res) => res.json(zServer.getOpenAPIDoc()));

        const port = process.env.HTTP_PORT || 8150;
        const httpServer = http.createServer(app);
        
        httpServer.listen(port, "::", async _ => {
            console.log("[Backend - " + version + "]. HTTP Server Started at Port " + port);
            const scheduller = new Scheduller();
            scheduller.init();
        });        
    } catch(error) {
        console.error("Can't start server", error);
        console.error("Exit (-1)")
        process.exit(-1);
    }
}



createHTTPServer();
