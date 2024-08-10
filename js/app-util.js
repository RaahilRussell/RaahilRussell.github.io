import { declade, createElement, xhrGet } from "./util.js";

export const teamNumbers = new Array(6).fill().map((value, i) => `6121${String.fromCharCode(i + "A".charCodeAt())}`);

export class RobotEventsApiError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

export async function robotEventsGet(endpointName, options = {}) {
    const response = JSON.parse(
        await xhrGet(`https://www.robotevents.com/api/v2/${endpointName}?${new URLSearchParams(options)}`, {
            headers: {
                Authorization: "Bearer YOUR_ACCESS_TOKEN", // Replace with your actual access token
            },
        })
    );

    if (!response.success) {
        throw new RobotEventsApiError(response.error, response.error_code);
    }

    return response.data;
}

export async function robotEventsGetForTeams(endpointName, teamNumbersTarget, options = {}, attachTeamNumber = false) {
    const promises = teamNumbersTarget.map(async (teamNumber) => {
        const resultObjects = await robotEventsGet(endpointName, { ...options, team: teamNumber });

        if (attachTeamNumber) {
            resultObjects.forEach((resultObject) => {
                resultObject.team = teamNumber;
            });
        }

        return resultObjects;
    });

    return await Promise.all(promises);
}

export async function robotEventsGetForAllTeams(endpointName, options, attachTeamNumber) {
    return (await robotEventsGetForTeams(endpointName, teamNumbers, options, attachTeamNumber)).flat();
}

export function createNotice(text) {
    return createElement("text-notice", {
        textContent: text,
    });
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateString(date) {
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function dateRangeString(start, end) {
    const singleDayEvent =
        start.getUTCDate() === end.getUTCDate() &&
        start.getUTCMonth() === end.getUTCMonth() &&
        start.getUTCFullYear() === end.getUTCFullYear();

    if (singleDayEvent) {
        return dateString(start);
    } else {
        return `${dateString(start)} – ${dateString(end)}`;
    }
}

export const generateInstanceDetails = {
    event(resultObject, instanceDetailsContainer) {
        instanceDetailsContainer = instanceDetailsContainer || createElement("instance-details");

        declade(instanceDetailsContainer).classList.remove("placeholder");

        createElement("instance-name", {
            children: [
                createElement("a", {
                    properties: {
                        href: `https://robotevents.com/${resultObject.sku}.html`,
                        target: "_blank",
                    },
                    textContent: resultObject.name,
                }),
            ],
            parent: instanceDetailsContainer,
        });

        createElement("div", {
            textContent: dateRangeString(new Date(resultObject.start_date), new Date(resultObject.end_date)),
            parent: instanceDetailsContainer,
        });

        return instanceDetailsContainer;
    },

    eventDetailed(resultObject, instanceDetailsContainer) {
        instanceDetailsContainer = this.event(resultObject, instanceDetailsContainer);

        const location = [resultObject.venue, resultObject.city, resultObject.region].join(", ");
        const mapLocation = [resultObject.address1, resultObject.city].join(", ");

        createElement("div", {
            children: [
                createElement("a", {
                    properties: {
                        href: `https://www.google.com/maps/place/${mapLocation}`,
                        target: "_blank",
                    },
                    textContent: location,
                }),
            ],
            parent: instanceDetailsContainer,
        });

        createElement("div", {
            textContent: resultObject.season,
            parent: instanceDetailsContainer,
        });

        return instanceDetailsContainer;
    },

    award(resultObject, instanceDetailsContainer, event) {
        instanceDetailsContainer = instanceDetailsContainer || createElement("instance-details");

        const date = event ? new Date(event.start_date) : NaN;

        declade(instanceDetailsContainer).classList.remove("placeholder");

        createElement("instance-name", {
            children: [
                createElement("a", {
                    properties: {
                        href: `https://robotevents.com/${resultObject.sku}.html`,
                    },
                    textContent: event ? event.name : resultObject.sku,
                }),
            ],
            parent: instanceDetailsContainer,
        });

        createElement("div", {
            textContent: event ? dateRangeString(date, new Date(event.end_date)) : "date unknown",
            parent: instanceDetailsContainer,
        });

        createElement("div", {
            textContent: resultObject.name,
            parent: instanceDetailsContainer,
        });

        return instanceDetailsContainer;
    },
};

export class ResultObjectRecordCollector {
    constructor({
        recordEncompasses = () => true,
        toDataObject = () => null,
        willAccept = () => true,
    } = {}) {
        this.recordEncompasses = recordEncompasses;
        this.toDataObject = toDataObject;
        this.willAccept = willAccept;

        this.clear();
    }

    addRecord(resultObject) {
        const record = new ResultObjectRecord(this.toDataObject(resultObject), this);
        this.records.push(record);
        return record;
    }

    async addRecordAsync(resultObject) {
        const record = new ResultObjectRecord(await Promise.resolve(this.toDataObject(resultObject)), this);
        this.records.push(record);
        return record;
    }

    collect(resultObjects) {
        for (const resultObject of resultObjects) {
            if (!this.willAccept(resultObject)) continue;

            let record = this.records.find((record) => record.encompasses(resultObject));

            if (!record) {
                record = this.addRecord(resultObject);
            }

            record.addInstance(resultObject);
        }
    }

    async collectAsync(resultObjects) {
        for (const resultObject of resultObjects) {
            if (!(await Promise.resolve(this.willAccept(resultObject)))) continue;

            let recordTarget;

            for (const record of this.records) {
                if (!(await Promise.resolve(this.recordEncompasses(record, resultObject)))) continue;

                recordTarget = record;
                break;
            }

            if (!recordTarget) {
                recordTarget = await this.addRecordAsync(resultObject);
            }

            recordTarget.addInstance(resultObject);
        }
    }

    instances() {
        return this.records.map((record) => record.instances).flat();
    }

    clear() {
        this.records = [];
        return this;
    }

    get nInstances() {
        return this.records.reduce((accumulator, record) => accumulator + record.count, 0);
    }
}

ResultObjectRecordCollector.createCommon = {
    eventsByScope(options = {}) {
        return new ResultObjectRecordCollector(
            Object.assign(
                {
                    recordEncompasses(record, resultObject) {
                        return record.data.scope === scopeOf(resultObject);
                    },

                    toDataObject(resultObject) {
                        return {
                            scope: scopeOf(resultObject),
                        };
                    },
                },
                options
            )
        );
    },

    awardsByType(options = {}) {
        return new ResultObjectRecordCollector(
            Object.assign(
                {
                    recordEncompasses(record, resultObject) {
                        return record.data.name === resultObject.name;
                    },

                    toDataObject(resultObject) {
                        return {
                            name: resultObject.name,
                            order: resultObject.order,
                        };
                    },
                },
                options
            )
        );
    },
};

class ResultObjectRecord {
    constructor(data, collector) {
        this.data = data;
        this.collector = collector;
        this.instances = [];
    }

    addInstance(resultObject) {
        if (!this.instances.includes(resultObject)) {
            this.instances.push(resultObject);
        }
        return this;
    }

    encompasses(resultObject) {
        return this.collector.recordEncompasses(this, resultObject);
    }

    get count() {
        return this.instances.length;
    }
}

export function scopeOf(resultObject) {
    for (const scopeName of scopeNames) {
        if (resultObject.name.toUpperCase().includes(scopeName.toUpperCase())) {
            return scopeName;
        }
    }

    return "";
}

export const scopeNames = ["World Championship", "U.S. Open", "State Championship", ""];

export function groomAwardName(name) {
    return name.replace(/ \(VRC\/VEXU\)/g, "");
}
