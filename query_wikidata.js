const BASE_URL = "https://query.wikidata.org/sparql?query="
const QUERY_TEMPLATE = `SELECT * WHERE { wd:Q31 wdt:P31 ?object . wd:Q279 wdt:P279+ ?object . }`
const headers = {
    Accept: "application/sparql-results+json"
}

const fetch = require('node-fetch');

let buildQueryString = (queryEntity, queryString, replaceProperty) => {
    // console.log(replaceProperty)
    if (replaceProperty) {
        return queryString.replace(new RegExp(`Q${replaceProperty.slice(1)}`), queryEntity)
    } else {
        return queryString.replace(/Q\w+/gi, queryEntity)
    }
}

async function getRequestEndpointAP1(queryString) {
    try {
        // console.log(`REQUESTING ${BASE_URL + encodeURIComponent(queryString)}...\n`)
        let request = await fetch(BASE_URL + encodeURIComponent(queryString), { headers })

        if (request) {
            // console.log(`REQUESTED. READING...\n`)
            let response = await request.json();
            // console.log(`RESPONSE:`)
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function queryP279(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { wd:${subclass} wdt:P279+ ${superclass} }`
    // console.log(P279_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), { headers })

        if (request) {
            let response = await request.json();
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function isSubclass(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { BIND( EXISTS { wd:${subclass} wdt:P279+ ${superclass} } as ?isSubclass ) }`
    // console.log(P279_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), { headers })

        if (request) {
            let response = await request.json();
            return response['results']['bindings'][0]["isSubclass"]['value'];
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function isInstance(instance, entity) {
    const P31_QUERY = `SELECT * WHERE { BIND( EXISTS { wd:${instance} wdt:P31 wd:${entity} } as ?isInstance ) }`

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P31_QUERY), { headers })

        if (request) {
            let response = await request.json();
            // console.log(response['results']['bindings'][0]["isInstance"]['value']);
            return response['results']['bindings'][0]["isInstance"]['value'];
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function querySuperclasses(entity) {

}

let parseResultValues = (result) => {
    // console.log(result);
    // console.log(result['object']['value']);
    return result['object']['value'].match(/Q\w+/)[0];
}

async function checkForAntipattern(entity, statement) {
    // console.log(statement);
    const { newEntity, newProperty } = statement;

    // Test for existing AP1
    const queryString = buildQueryString(entity, QUERY_TEMPLATE);
    // console.log(queryString);

    const response = await getRequestEndpointAP1(queryString);
    // console.log(response);
    const results = response['results']['bindings'];

    let QIDsExistent = results.map(parseResultValues);
    console.log(`${entity} is involved in AP1 with ${QIDsExistent.length} entities: ${QIDsExistent}.`)

    // Test for new statement
    let QIDsNew = [];
    console.log("\n\nChecking new antipattern")
    if (newProperty == "P31") { // "entity is instance of newEntity" is true
        queryResponse = await isSubclass(entity, 'wd:' + newEntity);
        queryResult = queryResponse['results']['bindings'][0]["isSubclass"]['value'];
        if (queryResult) { // is "entity is subclass of newEntity" also true?
            QIDsNew = newEntity; // then it is a violation
        }
    }
    else if (newProperty == "P279") { // "entity P279 newEntity" is true
        const superclassesQuery = await queryP279(newEntity, '?object'); // get all newEntity's superclasses
        const superclasses = superclassesQuery['results']['bindings'].map(parseResultValues);
        superclasses.push(newEntity);

        console.log("Superclasses: ", superclasses.slice(4));
        for (let superclass of superclasses.slice(4)) {
            const isEntityInstance = await !isInstance(entity, superclass);
            if (isEntityInstance) {
                // console.log(`${entity} is instance of ${superclass}.`)
                QIDsNew.push(superclass);
            }
        }

        // QIDsNew = await superclasses.map(await async function(superclass) { return isInstance(entity, superclass) });
        // const QIDsExistent = isInstance(entity, newEntity)); // is entity P31 newEntity or its superclasses also true?
        // if (QIDsExistent.length) { // is entity P279 newEntity also true?
        //     QIDsNew = true; // then it is a violation
        // }
    }

    let antipatterns = {
        existent: QIDsExistent,
        new: QIDsNew
    }
    console.log(antipatterns);

    // // Interpret results
    // if (antipatterns.existent.length) {
    //     if (!antipatterns.new) {
    //         // CASE 1: Entity isn't involved in AP1 and new statement does not introduce violations
    //         return antipatterns;
    //     } else {
    //         // CASE 2: Entity isn't involved in AP1 and new statement introduces violations

    //     }
    // }
    // else
    // {
    //     if (!antipatterns.new) {
    //         // CASE 3: Entity is already involved in AP1 and new statement does not introduce violations

    //     } else {
    //         // CASE 4: Entity is already involved in AP1 and new statement introduces violations

    //     }
    // }

    return antipatterns;
}

async function test() {
    // CASE 1
    console.log("CASE 1: Entity isn't involved in AP1 and new statement does not introduce violations (P279)")
    await checkForAntipattern("Q185667", { newEntity: "Q618779", newProperty: "P279" });
    console.log("CASE 1: Entity isn't involved in AP1 and new statement does not introduce violations (P31)")
    await checkForAntipattern("Q185667", { newEntity: "Q618779", newProperty: "P31" });
    // CASE 2
    console.log("CASE 2: Entity isn't involved in AP1 and new statement introduces violations (P279)")
    await checkForAntipattern("Q185667", { newEntity: "Q618779", newProperty: "P31" });
    console.log("CASE 2: Entity isn't involved in AP1 and new statement introduces violations (P31)")
    await checkForAntipattern("Q21198", { newEntity: "Q5422299", newProperty: "P279" });

    // CASE 3
    console.log("CASE 3: Entity is already involved in AP1 and new statement does not introduce violations (P279)")
    await checkForAntipattern("Q150", { newEntity: "Q85380120", newProperty: "P279" });
    console.log("CASE 3: Entity is already involved in AP1 and new statement does not introduce violations (P31)")
    await checkForAntipattern("Q150", { newEntity: "Q85380120", newProperty: "P31" });

    // CASE 4
    console.log("CASE 4: Entity is already involved in AP1 and new statement introduces violations (P279)")
    await checkForAntipattern("Q46525", { newEntity: "Q11448906", newProperty: "P279" });
    console.log("CASE 4: Entity is already involved in AP1 and new statement introduces violations (P31)")
    await checkForAntipattern("Q46525", { newEntity: "Q476300", newProperty: "P31" });
}

test()
