import fetch from "node-fetch";
import mongo from "./MongoDB.js";
import temblores from "./Temblores.js";
import Proceso from "./Proceso.js";

const USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const DESCARGA_ID = "temblores-usgs";
const MAX_FEATURES_POR_BLOQUE = 20000;
const DEFAULT_START_DATE = process.env.USGS_TEMBLORES_START_DATE || "1900-01-01T00:00:00.000Z";

class DescargaTembloresUSGS extends Proceso {
    static get instance() {
        if (DescargaTembloresUSGS._singleton) return DescargaTembloresUSGS._singleton;
        DescargaTembloresUSGS._singleton = new DescargaTembloresUSGS();
        return DescargaTembloresUSGS._singleton;
    }

    get codigo() {
        return "descarga-temblores-usgs";
    }

    get nombre() {
        return "Descarga de temblores USGS";
    }

    get descripcion() {
        return "Descarga inicial e incremental de eventos sismicos desde USGS hacia la coleccion temblores";
    }

    async ejecutaDescargaPendiente(options = {}) {
        return await this.ejecuta(options);
    }

    async run() {
        const estado = await this.leeEstadoDescarga();
        const resultado = (!estado || !estado.ultimoTiempo)
            ? await this.descargaInicialCompleta()
            : await this.descargaIncremental();
        await this.logResumenDescarga(resultado);
        return resultado;
    }

    async descargaInicialCompleta() {
        const inicio = new Date(DEFAULT_START_DATE);
        if (isNaN(inicio.getTime())) throw "ERR_FECHA_INICIO_USGS_INVALIDA";
        const fin = new Date();
        await this.logInfo(`Iniciando descarga historica completa desde ${inicio.toISOString()} hasta ${fin.toISOString()}`);
        return await this.descargaRango(inicio, fin, { historica: true });
    }

    async descargaIncremental() {
        const estado = await this.leeEstadoDescarga();
        const ultimoTiempo = estado?.ultimoTiempo || await temblores.getUltimoTiempoTemblor();
        if (!ultimoTiempo) return await this.descargaInicialCompleta();
        const inicio = new Date(Number(ultimoTiempo) + 1);
        const fin = new Date();
        if (inicio.getTime() > fin.getTime()) {
            await this.logInfo("No hay rango incremental pendiente");
            return { estado: "ok", descargados: 0, inicio: inicio.toISOString(), fin: fin.toISOString() };
        }
        await this.logInfo(`Iniciando descarga incremental desde ${inicio.toISOString()} hasta ${fin.toISOString()}`);
        return await this.descargaRango(inicio, fin, { historica: false });
    }

    async descargaRango(inicio, fin, opciones = {}) {
        try {
            let actual = new Date(inicio);
            let total = 0;
            let bloques = 0;
            while (actual.getTime() < fin.getTime()) {
                await this.verificaDetencionSolicitada();
                const siguiente = this.minDate(this.inicioSiguienteAnio(actual), fin);
                const resultado = await this.descargaBloque(actual, siguiente, opciones);
                total += resultado.descargados;
                bloques += resultado.bloques;
                actual = siguiente;
            }
            await this.actualizaEstadoDescarga({
                estado: "ok",
                bloqueActual: null,
                mensaje: null,
                ultimaEjecucionUTC: new Date().toISOString()
            });
            return { estado: "ok", descargados: total, bloques };
        } catch (error) {
            await this.actualizaEstadoDescarga({
                estado: "error",
                mensaje: error?.message || error?.toString() || "ERR_DESCARGA_USGS",
                bloqueActual: null,
                ultimaEjecucionUTC: new Date().toISOString()
            });
            throw error;
        }
    }

    async descargaBloque(inicio, fin, opciones = {}) {
        const inicioDate = new Date(inicio);
        const finDate = new Date(fin);
        await this.verificaDetencionSolicitada();
        await this.actualizaEstadoDescarga({
            estado: "ejecutando",
            bloqueActual: {
                inicioUTC: inicioDate.toISOString(),
                finUTC: finDate.toISOString()
            },
            ultimaEjecucionUTC: new Date().toISOString(),
            mensaje: null
        });
        try {
            const resultado = await this.descargaBloqueAdaptativo(inicioDate, finDate, opciones);
            return resultado;
        } catch (error) {
            const mensaje = error?.message || error?.toString() || "ERR_DESCARGA_USGS";
            await this.actualizaEstadoDescarga({
                estado: "error",
                mensaje,
                bloqueActual: {
                    inicioUTC: inicioDate.toISOString(),
                    finUTC: finDate.toISOString()
                },
                ultimaEjecucionUTC: new Date().toISOString()
            });
            throw error;
        }
    }

    async descargaBloqueAdaptativo(inicio, fin, opciones = {}) {
        try {
            await this.verificaDetencionSolicitada();
            const resultado = await this.invocaUSGS(inicio, fin);
            await this.verificaDetencionSolicitada();
            if (resultado.features.length >= MAX_FEATURES_POR_BLOQUE && this.puedeDividir(inicio, fin)) {
                return await this.descargaBloqueDividido(inicio, fin, opciones);
            }
            const tembloresBloque = resultado.features.map(feature => this.transformaFeatureUSGS(feature)).filter(t => t);
            await temblores.guardaTemblores(tembloresBloque);
            await this.actualizaUltimoTiempo(tembloresBloque);
            return { descargados: tembloresBloque.length, bloques: 1 };
        } catch (error) {
            if (!this.puedeDividir(inicio, fin)) throw error;
            await this.logWarning(`Dividiendo bloque ${inicio.toISOString()} - ${fin.toISOString()} por error: ${error?.message || error}`);
            return await this.descargaBloqueDividido(inicio, fin, opciones);
        }
    }

    async descargaBloqueDividido(inicio, fin, opciones = {}) {
        await this.verificaDetencionSolicitada();
        const medio = new Date(Math.floor((inicio.getTime() + fin.getTime()) / 2));
        const r1 = await this.descargaBloqueAdaptativo(inicio, medio, opciones);
        await this.verificaDetencionSolicitada();
        const r2 = await this.descargaBloqueAdaptativo(medio, fin, opciones);
        return {
            descargados: r1.descargados + r2.descargados,
            bloques: r1.bloques + r2.bloques
        };
    }

    async invocaUSGS(inicio, fin) {
        await this.verificaDetencionSolicitada();
        const anio = inicio.getUTCFullYear();
        const inicioISO = inicio.toISOString();
        const finISO = fin.toISOString();
        await this.logInfo(`Descargando temblores USGS anio ${anio}: ${inicioISO} - ${finISO}`);

        const params = new URLSearchParams({
            format: "geojson",
            starttime: inicioISO,
            endtime: finISO,
            orderby: "time-asc",
            limit: String(MAX_FEATURES_POR_BLOQUE)
        });
        const url = `${USGS_QUERY_URL}?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`USGS ${response.status}: ${text}`);
        }
        const json = await response.json();
        if (!json || !Array.isArray(json.features)) throw new Error("USGS: respuesta GeoJSON invalida");
        await this.logInfo(`USGS respondio ${json.features.length} registros para anio ${anio}: ${inicioISO} - ${finISO}`);
        return json;
    }

    async logResumenDescarga(resultado) {
        const totalBaseDatos = await this.getTotalTemblores();
        resultado.totalBaseDatos = totalBaseDatos;
        await this.logInfo(`Resumen descarga temblores USGS: ${resultado.descargados || 0} registros descargados en esta ejecucion; ${totalBaseDatos} registros totales en base de datos`);
    }

    async getTotalTemblores() {
        const col = await mongo.collection("temblores");
        return await col.countDocuments();
    }

    transformaFeatureUSGS(feature) {
        if (!feature || !feature.id || !feature.properties || !feature.geometry) return null;
        const coordinates = Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [];
        const tiempo = Number(feature.properties.time);
        if (!Number.isFinite(tiempo)) return null;
        const magnitud = feature.properties.mag === null || feature.properties.mag === undefined ? null : Number(feature.properties.mag);
        const tipoMagnitud = feature.properties.magType || null;
        return {
            _id: feature.id,
            fuente: "USGS",
            fechaUTC: new Date(tiempo).toISOString(),
            tiempo,
            latitud: coordinates.length > 1 ? coordinates[1] : null,
            longitud: coordinates.length > 0 ? coordinates[0] : null,
            profundidadKm: coordinates.length > 2 ? coordinates[2] : null,
            magnitud: Number.isFinite(magnitud) ? magnitud : null,
            tipoMagnitud,
            procesado: false,
            valido: false
        };
    }

    async leeEstadoDescarga() {
        const col = await mongo.collection("descargas");
        return await col.findOne({ _id: DESCARGA_ID });
    }

    async actualizaEstadoDescarga(cambios) {
        const col = await mongo.collection("descargas");
        await col.updateOne(
            { _id: DESCARGA_ID },
            {
                $set: {
                    fuente: "USGS",
                    coleccion: "temblores",
                    ...cambios
                },
                $setOnInsert: { _id: DESCARGA_ID }
            },
            { upsert: true }
        );
    }

    async actualizaUltimoTiempo(tembloresBloque) {
        const tiempos = tembloresBloque
            .map(t => t.tiempo)
            .filter(t => Number.isFinite(t));
        if (!tiempos.length) return;
        const maxTiempo = Math.max(...tiempos);
        const estado = await this.leeEstadoDescarga();
        if (estado?.ultimoTiempo && Number(estado.ultimoTiempo) >= maxTiempo) return;
        await this.actualizaEstadoDescarga({
            ultimoTiempo: maxTiempo,
            ultimaFechaUTC: new Date(maxTiempo).toISOString()
        });
    }

    inicioSiguienteAnio(date) {
        return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
    }

    minDate(d1, d2) {
        return d1.getTime() < d2.getTime() ? d1 : d2;
    }

    puedeDividir(inicio, fin) {
        return fin.getTime() - inicio.getTime() > 24 * 60 * 60 * 1000;
    }
}

export default Proceso.registra(DescargaTembloresUSGS.instance);
