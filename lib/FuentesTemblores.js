import fs from "fs";
import HJSON from "hjson";

const CONFIG_PATH = process.env.FUENTES_TEMBLORES_CONFIG_PATH || "/config/fuentes-temblores.hjson";

class FuentesTemblores {
    constructor(configPath = CONFIG_PATH) {
        this.configPath = configPath;
        this.fuentes = this.leeConfig();
    }

    leeConfig() {
        if (!fs.existsSync(this.configPath)) throw new Error(`No existe configuracion de fuentes: ${this.configPath}`);
        const config = HJSON.parse(fs.readFileSync(this.configPath).toString());
        if (!Array.isArray(config?.fuentes) || !config.fuentes.length) throw new Error("ERR_FUENTES_TEMBLORES_VACIAS");
        const codigos = new Set();
        return config.fuentes.map(fuente => {
            if (!fuente?.codigo || !fuente?.tipo || !fuente?.url) throw new Error("ERR_FUENTE_TEMBLORES_INVALIDA");
            if (codigos.has(fuente.codigo)) throw new Error(`ERR_FUENTE_TEMBLORES_DUPLICADA: ${fuente.codigo}`);
            codigos.add(fuente.codigo);
            const desde = Date.parse(fuente.desde || "1900-01-01T00:00:00.000Z");
            const hasta = fuente.hasta ? Date.parse(fuente.hasta) : Number.POSITIVE_INFINITY;
            if (!Number.isFinite(desde) || (!Number.isFinite(hasta) && fuente.hasta)) {
                throw new Error(`ERR_VIGENCIA_FUENTE_INVALIDA: ${fuente.codigo}`);
            }
            return {
                ...fuente,
                prioridad: Number(fuente.prioridad || 0),
                desdeTiempo: desde,
                hastaTiempo: hasta,
                areas: Array.isArray(fuente.areas) ? fuente.areas : []
            };
        }).sort((a, b) => b.prioridad - a.prioridad);
    }

    get inicioMasAntiguo() {
        return Math.min(...this.fuentes.map(f => f.desdeTiempo));
    }

    cubre(fuente, temblor) {
        if (!fuente || !temblor || temblor.tiempo < fuente.desdeTiempo || temblor.tiempo >= fuente.hastaTiempo) return false;
        if (!fuente.areas.length) return true;
        return fuente.areas.some(area => this.puntoEnPoligono(temblor.longitud, temblor.latitud, area.poligono));
    }

    puntoEnPoligono(longitud, latitud, poligono) {
        if (!Number.isFinite(longitud) || !Number.isFinite(latitud) || !Array.isArray(poligono) || poligono.length < 3) return false;
        let dentro = false;
        for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
            const [xi, yi] = poligono[i];
            const [xj, yj] = poligono[j];
            const cruza = ((yi > latitud) !== (yj > latitud)) &&
                (longitud < (xj - xi) * (latitud - yi) / ((yj - yi) || Number.EPSILON) + xi);
            if (cruza) dentro = !dentro;
        }
        return dentro;
    }
}

export default FuentesTemblores;
