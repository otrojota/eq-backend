import fs from "fs";
import HJSON from "hjson";
import cron from "node-cron";
import Proceso from "./Proceso.js";

class Scheduller {
    constructor(configPath = process.env.SCHEDULLER_CONFIG_PATH || "/config/scheduller.hjson") {
        this.configPath = configPath;
        this.tasks = [];
    }

    init() {
        const config = this.leeConfig();
        const tareas = this.normalizaTareas(config);
        for (const tarea of tareas) {
            this.registraTarea(tarea);
        }
        console.log(`[Scheduller] ${this.tasks.length} tarea(s) registradas desde ${this.configPath}`);
    }

    leeConfig() {
        if (!fs.existsSync(this.configPath)) {
            console.warn(`[Scheduller] No existe archivo de configuracion: ${this.configPath}`);
            return [];
        }
        const contenido = fs.readFileSync(this.configPath).toString().trim();
        if (!contenido) return [];
        return HJSON.parse(contenido);
    }

    normalizaTareas(config) {
        if (Array.isArray(config)) return config;
        if (Array.isArray(config?.tareas)) return config.tareas;
        if (Array.isArray(config?.procesos)) return config.procesos;
        return [];
    }

    registraTarea(tarea) {
        if (!tarea?.id) throw "ERR_SCHEDULLER_TAREA_SIN_ID";
        if (!tarea?.codigoProceso) throw "ERR_SCHEDULLER_TAREA_SIN_CODIGO_PROCESO";
        if (!tarea?.cron) throw "ERR_SCHEDULLER_TAREA_SIN_CRON";
        if (!cron.validate(tarea.cron)) throw `ERR_SCHEDULLER_CRON_INVALIDO: ${tarea.id}`;

        const task = cron.schedule(tarea.cron, async _ => {
            await this.ejecutaTarea(tarea);
        }, {
            scheduled: true,
            timezone: tarea.timezone || "UTC"
        });
        this.tasks.push({ tarea, task });
        console.log(`[Scheduller] Registrada tarea ${tarea.id} (${tarea.nombre || tarea.codigoProceso}) cron=${tarea.cron}`);
    }

    async ejecutaTarea(tarea) {
        const proceso = Proceso.getProceso(tarea.codigoProceso);
        if (!proceso) {
            console.error(`[Scheduller] Proceso no registrado para tarea ${tarea.id}: ${tarea.codigoProceso}`);
            return;
        }
        try {
            const valoresFijos = tarea.valoresFijos ?? tarea.valores ?? tarea.parametros ?? tarea.options ?? {};
            if (!valoresFijos || typeof valoresFijos !== "object" || Array.isArray(valoresFijos)) {
                throw { status: 400, message: `ERR_SCHEDULLER_VALORES_INVALIDOS: ${tarea.id}` };
            }
            const options = proceso.validaOptions({
                ...valoresFijos,
                scheduller: {
                    id: tarea.id,
                    nombre: tarea.nombre || null,
                    cron: tarea.cron
                }
            });
            await proceso.ejecuta(options);
        } catch (error) {
            console.error(`[Scheduller] Error ejecutando tarea ${tarea.id}`, error);
        }
    }
}

export default Scheduller;
