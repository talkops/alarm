import { CronJob } from 'cron'
import { Extension } from 'talkops'
import { JSONFilePreset } from 'lowdb/node'
import yaml from 'js-yaml'

const db = await JSONFilePreset('/data/db.json', { alarms: [] })

const extension = new Extension()
  .setName('Alarm')
  .setCategory('utility')
  .setIcon('https://talkops.app/images/extensions/alarm.png')
  .setFeatures(['Create a recurring alarm', 'Check alarm states', 'Delete an alarm'])
  .start()

const instructions = []
instructions.push(`
You can manage multiple recurring alarms.
Alarms are scheduled using specific times or cron expressions.
Use format like "0 9 * * *" to set an alarm at 9am every day.
`)
instructions.push('``` yaml')
instructions.push(
  yaml.dump({
    alarms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: {
            type: 'integer',
            description: 'The number of the alarm.',
          },
          name: {
            type: 'string',
            description: 'The name of the alarm.',
          },
          cron: {
            type: 'string',
            description: 'The cron of the alarm.',
          },
          timeZone: {
            type: 'string',
            description: 'The IANA time zone of the alarm.',
          },
        },
      },
    },
  }),
)
instructions.push('```')
extension.setInstructions(instructions.join('\n'))

extension.setFunctionSchemas([
  {
    name: 'create_alarm',
    description: 'Create an alarm.',
    parameters: {
      type: 'object',
      properties: {
        cron: {
          type: 'string',
          description: 'The cron of the alarm.',
        },
        name: {
          type: 'string',
          description: 'The name of the alarm.',
        },
        timeZone: {
          type: 'string',
          description: 'The IANA time zone of the alarm.',
        },
      },
      required: ['cron', 'name'],
    },
  },
  {
    name: 'delete_alarm',
    description: 'Cancel an alarm.',
    parameters: {
      type: 'object',
      properties: {
        number: {
          type: 'integer',
          description: 'The number of the alarm.',
        },
      },
      required: ['number'],
    },
  },
  {
    name: 'get_alarms',
    description: 'Get alarms.',
  },
  {
    name: 'update_alarm',
    description: 'Update an alarm.',
    parameters: {
      type: 'object',
      properties: {
        number: {
          type: 'integer',
          description: 'The number of the alarm.',
        },
        cron: {
          type: 'string',
          description: 'The cron of the alarm.',
        },
        name: {
          type: 'string',
          description: 'The name of the alarm.',
        },
        timeZone: {
          type: 'string',
          description: 'The IANA time zone of the alarm.',
        },
      },
      required: ['number'],
    },
  },
])

const jobs = new Map()

function getNextAlarmNumber() {
  let number = 1
  for (const alarm of db.data.alarms) {
    if (alarm.number < number) continue
    number = alarm.number + 1
  }
  return number
}

function scheduleAlarm(alarm) {
  const job = new CronJob(
    alarm.cron,
    () => {
      extension.enableAlarm()
      extension.sendMessage(`Alarm "${alarm.name}" #${alarm.number} is ringing!`)
    },
    null,
    false,
    alarm.timeZone,
  )
  job.start()
  jobs.set(alarm.number, job)
}

function unscheduleAlarm(number) {
  const job = jobs.get(number)
  if (job) {
    job.stop()
    jobs.delete(number)
  }
}

extension.setFunctions([
  function create_alarm(cron, name, timeZone) {
    const number = getNextAlarmNumber()
    const alarm = { number, cron, name, timeZone }
    db.update(({ alarms }) => alarms.push(alarm))
    scheduleAlarm(alarm)
    return `Alarm "${name}" #${number} has been scheduled.\n${yaml.dump(alarm)}`
  },
  function get_alarms() {
    return yaml.dump(db.data.alarms).trim()
  },
  function delete_alarm(number) {
    for (const alarm of db.data.alarms) {
      if (alarm.number !== number) continue
      db.data.alarms = db.data.alarms.filter((t) => t !== alarm)
      db.write()
      unscheduleAlarm(alarm.number)
      return `Alarm #${number} has been deleted.`
    }
    return 'Not found.'
  },
  function update_alarm(number, cron, name, timeZone) {
    const alarms = db.data.alarms
    const index = alarms.findIndex((a) => a.number === number)
    if (index === -1) {
      return `Alarm #${number} not found.`
    }
    const updatedAlarm = {
      ...alarms[index],
      cron: cron || alarms[index].cron,
      name: name || alarms[index].name,
      timeZone: timeZone || alarms[index].timeZone,
    }
    db.data.alarms[index] = updatedAlarm
    db.write()
    unscheduleAlarm(number)
    scheduleAlarm(updatedAlarm)
    return `Alarm #${number} has been updated.\n${yaml.dump(updatedAlarm)}`
  },
])

for (const alarm of db.data.alarms) {
  scheduleAlarm(alarm)
}
