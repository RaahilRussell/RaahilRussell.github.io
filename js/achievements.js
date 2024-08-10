import {qs, qsa, createElement, declade} from "./util.js";
import {teamNumbers, robotEventsGetForTeams, createNotice, ResultObjectRecordCollector, groomAwardName, generateInstanceDetails} from "./app-util.js";
import {LoadingSign} from "./ce/LoadingSign.js";

const instanceDisplay = qs("instance-display");

class RecordCollectorWrapper {
    constructor({
        collector,
        endpointName,
        displayElementName,
        sortRecords,
        generateBlockLabel,
        buildInstancesDisplay,
        queryOptions = {},
    } = {}) {
        this.collector = collector;
        this.endpointName = endpointName;
        this.grid = qs(`block-grid[name="${displayElementName}"]`);
        this.nLoadingFails = 0;

        this.sortRecords = sortRecords;
        this.generateBlockLabel = generateBlockLabel;
        this.buildInstancesDisplay = buildInstancesDisplay;

        this.queryOptions = queryOptions;

        this.constructor.mapFromCollectors.set(collector, this);
    }

    async count(teamNumbersTarget) {
        const resultObjects = (await robotEventsGetForTeams(teamNumbersTarget, this.queryOptions, true)).flat();
        await this.collector.collectAsync(resultObjects);
        this.updateDisplay();
    }

    updateDisplay() {
        declade(this.grid);

        this.collector.records = this.sortRecords(this.collector);

        for (const record of this.collector.records) {
            createBlock(record.count, this.generateBlockLabel(record), this.grid, false, record);
        }

        const nTotal = this.collector.records.reduce((accumulator, {count}) => accumulator + count, 0);
        createBlock(nTotal, "Total", this.grid, true, this);
    }

    async displayCategoryInstances(instances) {
        declade(instanceDisplay);
        if (instances.length === 0) {
            instanceDisplay.appendChild(createNotice("No instances fit this category"));
            return;
        }

        const instancesByTeam = countCategoryInstancesByTeam(instances);
        const instancesByTeamEntries = Object.entries(instancesByTeam).sort((a, b) => a[0].localeCompare(b[0]));

        for (const [teamNumber, instances] of instancesByTeamEntries) {
            createElement("h3", {
                children: [
                    createElement("a", {
                        properties: {
                            href: `../teams/${teamNumber}/`,
                        },
                        textContent: teamNumber,
                    }),
                ],
                parent: instanceDisplay,
            });

            createElement("instance-subcounter", {
                textContent: instances.length,
                parent: instanceDisplay,
            });

            const list = createElement("instance-list", {
                parent: instanceDisplay,
            });

            for (let i = 0; i < instances.length; i++) {
                createElement("instance-details", {
                    children: [
                        createNotice("Loading..."),
                    ],
                    classes: ["placeholder"],
                    parent: list,
                });
            }

            this.buildInstancesDisplay(instances, list);
        }
    }
}

RecordCollectorWrapper.mapFromCollectors = new WeakMap();
RecordCollectorWrapper.loadingSigns = new WeakMap();

const awardsWrapper = new RecordCollectorWrapper({
    collector: ResultObjectRecordCollector.createCommon.awardsByType({
        async willAccept(resultObject) {
            const event = await findEvent(resultObject.sku);
            return !event || new Date() > new Date(event.end);
        },
    }),
    endpointName: "awards",
    displayElementName: "awards",

    sortRecords(collector) {
        return collector.records.sort((a, b) => a.data.order - b.data.order);
    },

    generateBlockLabel(record) {
        return groomAwardName(record.data.name);
    },

    buildInstancesDisplay(instances, list) {
        for (let i = 0; i < instances.length; i++) {
            const instance = instances[i];
            const instanceDetailsContainer = list.children[i];

            (async () => {
                const event = await findEvent(instance.sku);
                generateInstanceDetails.award(instance, instanceDetailsContainer, event);
            })();
        }
    },
});

async function findEvent(sku) {
    for (const instance of eventScopeWrapper.collector.instances()) {
        if (instance.sku === sku) {
            return instance;
        }
    }
    return (await robotEventsGet("events", {sku})).result[0];
}

// Utility Functions

function createBlock(number, label, parent, emphasize = false, collectorWrapper) {
    const classes = ["button", "item"];
    if (emphasize) classes.push("em");
    const id = `stat-viewer-control_${nBlock}`;

    const input = createElement("input", {
        properties: {
            name: "stat-viewer-control",
            type: "radio",
            id,
        },
        parent,
    });

    inputsToRecords.set(input, collectorWrapper);

    createElement("label", {
        attributes: [["for", id]],
        classes,
        children: [
            createElement("big-number", { textContent: number }),
            createElement("h4", { textContent: label }),
        ],
        parent,
    });
    nBlock++;
}

function countCategoryInstancesByTeam(instances) {
    const instancesByTeam = {};
    for (const instance of instances) {
        if (!instancesByTeam[instance.team]) instancesByTeam[instance.team] = [];
        instancesByTeam[instance.team].push(instance);
    }
    return instancesByTeam;
}

function instanceDisplayInit() {
    declade(instanceDisplay).appendChild(createNotice("Select a statistic to view its instances..."));
}

// Init

const filterRows = qs("filter-rows");
const recordForm = qs("form.stat-options");

function selectedRecord() {
    return qs("input:checked", recordForm);
}

const inputsToRecords = new WeakMap();

recordForm.addEventListener("change", () => {
    const record = inputsToRecords.get(selectedRecord());
    if (!record) {
        instanceDisplayInit();
    } else if (record instanceof RecordCollectorWrapper) {
        const collectorWrapper = record;
        const instances = collectorWrapper.collector.instances();
        collectorWrapper.displayCategoryInstances(instances);
    } else {
        const instances = record.instances;
        RecordCollectorWrapper.mapFromCollectors.get(record.collector).displayCategoryInstances(instances);
    }
});

let querying = false;

function query() {
    if (querying) return;

    instanceDisplayInit();
    const record = selectedRecord();
    if (record) record.checked = false;

    filterRows.classList.add("disabled");
    querying = true;

    const teamNumbersTarget = [...qsa("input[name='team-filter']:checked", filterRows)].map(input => input.value);
    const statusPromises = [];

    for (const collectorWrapper of [eventScopeWrapper, awardsWrapper]) {
        const asyncCallback = () => {
            const loadingSignOld = RecordCollectorWrapper.loadingSigns.get(collectorWrapper);
            if (loadingSign !== loadingSignOld && loadingSignOld) loadingSignOld.remove();
            RecordCollectorWrapper.loadingSigns.set(collectorWrapper, loadingSign);
            declade(collectorWrapper.grid).parentElement.insertBefore(loadingSign, collectorWrapper.grid);
            collectorWrapper.collector.clear();

            return collectorWrapper.count(teamNumbersTarget.length !== 0 ? teamNumbersTarget : teamNumbers);
        };

        const oncallbackresolve = () => {
            loadingSign.remove();
        };

        const loadingSign = LoadingSign.create(asyncCallback, oncallbackresolve);

        statusPromises.push(new Promise(resolve => {
            loadingSign.run().finally(resolve);
        }));
    }

    Promise.all(statusPromises).then(() => {
        filterRows.classList.remove("disabled");
        querying = false;
    });
}

filterRows.addEventListener("change", () => {
    query();
});

query();
