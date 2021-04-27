const BASE_URL = "https://query.wikidata.org/sparql?query="
const headers = {
    Accept: "application/sparql-results+json"
}

const fetch = require('node-fetch')


let buildQueryString = (queryEntity, queryString, replaceProperty) => {
    if (replaceProperty) {
        return queryString.replace(new RegExp(`Q${replaceProperty.slice(1)}`), queryEntity)
    } else {
        return queryString.replace(/Q\w+/gi, queryEntity)
    }
}

async function getRequestEndpointAP1(queryString) {
    try {
        let request = await fetch(BASE_URL + encodeURIComponent(queryString), { headers })

        if (request) {
            let response = await request.json();
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function queryP279(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { wd:${subclass} wdt:P279+ ${superclass} }`

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

async function areInstancesBulk(instance, entities) {
    let P31_QUERY = "SELECT * WHERE {\n"

    let nEntities = 0;
    for (let entity of entities) {
        P31_QUERY += `BIND( EXISTS { wd:${instance} wdt:P31 wd:${entity} } as ?isInstance${nEntities} ) .\n`
        nEntities++;
    }
    P31_QUERY += "}"

    console.log(P31_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P31_QUERY), { headers })

        if (request) {
            let response = await request.json();
            const results = Object.values(response['results']['bindings'][0]);

            nEntities = 0;
            let areInstances = {true: [], false: []};
            for (let result of results) {
                areInstances[result['value']].push(entities[nEntities]);
                nEntities++;
            }

            return areInstances;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

let parseResultValues = (result) => {
    return result['subject' || 'object']['value'].match(/Q\w+/)[0];
}

async function checkForAntipatternUp(entity, statement) {
    const AP1_QUERY_TEMPLATE_UP = `SELECT * WHERE { wd:Q31 wdt:P31 ?object . wd:Q279 wdt:P279+ ?object . }`

    let { newEntity, newProperty } = (statement || { undefined });

    // Check for existing AP1
    const queryString = buildQueryString(entity, AP1_QUERY_TEMPLATE_UP);

    const response = await getRequestEndpointAP1(queryString);
    const results = response['results']['bindings'];

    let QIDsExistent = results.map(parseResultValues);

    // Check for AP1 with new statement
    let QIDsNew = [];
    if (newProperty == "P31") { // "entity is instance of newEntity" is true
        queryResult = await isSubclass(entity, 'wd:' + newEntity);
        if (queryResult == "true") { // is "entity is subclass of newEntity" also true?
            QIDsNew = newEntity; // then it is a violation
        }
    }
    else if (newProperty == "P279") { // "entity P279 newEntity" is true
        const superclassesQuery = await queryP279(newEntity, '?object'); // get all newEntity's superclasses
        const superclasses = superclassesQuery['results']['bindings'].map(parseResultValues);
        superclasses.push(newEntity);
        let areInstances = await areInstancesBulk(entity, superclasses); // is entity P31 newEntity or its superclasses also true?
        QIDsNew = areInstances['true'];
    }

    let antipatternsUp = {
        existent: QIDsExistent,
        new: QIDsNew
    }

    console.log(antipatternsUp);

    return antipatternsUp;
}


async function checkForAntipatternDown(entity, statement) {
    const AP1_QUERY_TEMPLATE_DOWN = `SELECT * WHERE { ?subject wdt:P31 wd:Q31 . ?subject wdt:P279+ wd:Q279  . }`

    let { newEntity, newProperty } = (statement || { undefined });

    const queryString = buildQueryString(entity, AP1_QUERY_TEMPLATE_DOWN);
    console.log(queryString);
    const response = await getRequestEndpointAP1(queryString);
    const results = response['results']['bindings'];

    let QIDsInstancesAndSubclasses = results.map(parseResultValues);
    console.log(QIDsInstancesAndSubclasses);

    let antipatternsUp = {
        existent: QIDsInstancesAndSubclasses,
        new: QIDsNew
    }

    return antipatternsUp;
}


function getUrlVars() {
    var vars = {};
    var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m, key, value) {
        vars[key] = value;
    });
    return vars;
}

async function handleParams() {
    params = getUrlVars();
    let antipatternsUp, antipatternsUp;

    const inputEntity = params["inputEntity"].toUpperCase();
    const inputNewProperty = params["inputNewProperty"].toUpperCase();
    const inputNewEntity = params["inputNewEntity"].toUpperCase();

    switch (params['analysis-option']) {
        case 'existent':
            antipatternsUp = await checkForAntipatternUp(inputEntity);
            antipatternsDown = await checkForAntipatternDown(inputEntity);
            break;
        case 'new':
            const statement = {
                newEntity: inputNewEntity,
                newProperty: inputNewProperty
            };
            antipatternsUp = await checkForAntipatternUp(inputEntity, statement);
            antipatternsDown = await checkForAntipatternDown(inputEntity, statement);

            const comment = document.querySelector("#comment");

            let commentTitle = document.createElement('p');
            commentTitle.innerHTML = "New statement:"

            let newStatementQuery = document.createElement('code');
            newStatementQuery.innerHTML = `<a href=https://www.wikidata.org/wiki/${inputEntity}><i>wd:${inputEntity}</a> <a href=https://www.wikidata.org/wiki/Property:${inputNewProperty}>wdt:${inputNewProperty}</a> <a href=https://www.wikidata.org/wiki/${inputNewEntity}>wd:${inputNewEntity}</i></a>`

            comment.appendChild(commentTitle);
            comment.appendChild(newStatementQuery);
            break;
        default:
            console.log("Unrecognized option.")
    }
    if (antipatternsUp) {
        if (antipatternsUp['existent'].length > 0) {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")

            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is involved</b> in AP1 with <u>${antipatternsUp['existent']}</u>.`
            results.appendChild(resultItem);
        } else {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is not involved</b> in AP1.`

            results.appendChild(resultItem);
        }
        if (antipatternsUp['new'].length > 0) {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would be involved</b> in AP1 with <u>${antipatternsUp['new']}</u> regarding the new statement.`

            results.appendChild(resultItem);
        } else if (params['analysis-option'] == 'new') {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would not be involved</b> in AP1 regarding the new statement.`

            results.appendChild(resultItem);
        }
    if (antipatternsDown) {
        if (antipatternsDown['existent'].length > 0) {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")

            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is involved</b> in AP1 with <u>${antipatternsDown['existent']}</u>.`
            results.appendChild(resultItem);
        } else {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is not involved</b> in AP1.`

            results.appendChild(resultItem);
        }
        if (antipatternsDown['new'].length > 0) {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would be involved</b> in AP1 with <u>${antipatternsDown['new']}</u> regarding the new statement.`

            results.appendChild(resultItem);
        } else if (params['analysis-option'] == 'new') {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would not be involved</b> in AP1 regarding the new statement.`

            results.appendChild(resultItem);
        }
    } else {
        console.log(`Failed to acquire results for anti-patterns above ${inputEntity}.`)
    }
}

// handleParams()
// checkForAntipatternDown("Q282")
// checkForAntipatternDown("Q12737077")
checkForAntipatternDown("Q618779")
// checkForAntipatternDown("Q41710")
