const sheetTriggers = {
  "Document Properties":   updatePropertiesOnEdit
}

const sheetNamesWithNoCellTriggers = [
  "Document Properties",
  "Debug Log"
]

const finalSheetTriggers = {
  "Trips":                 updateRunsOnEdit
}

const rangeTriggers = {
  codeFillRequestCells: {
    functionCall: fillRequestCells,
    callOncePerRow: true
  },
  codeFormatAddress: {
    functionCall: formatAddress,
    callOncePerRow: false
  },
  codeFillHoursAndMiles: {
    functionCall: fillHoursAndMiles,
    callOncePerRow: true
  },
  codeSetCustomerKey: {
    functionCall: setCustomerKey,
    callOncePerRow: true
  },
  codeScanForDuplicates: {
    functionCall: scanForDuplicates,
    callOncePerRow: false
  },
  codeUpdateTripTimes: {
    functionCall: updateTripTimes,
    callOncePerRow: true
  },
  codeUpdateTripVehicle: {
    functionCall: updateTripVehicleOnEdit,
    callOncePerRow: true
  }
}

/**
 * The event handler triggered when editing the spreadsheet.
 * @param {event} e The onEdit event.
 */
function onEdit(e) {
  const startTime = new Date()
  const sheetName = e.range.getSheet().getName()
  try {  
    callSheetTriggers(e, sheetName, sheetTriggers)
    callCellTriggers(e)
    callSheetTriggers(e, sheetName, finalSheetTriggers)
  } catch(e) {
    log(e.name + ': ' + e.message)
  } finally {
    log("onEdit duration:",(new Date()) - startTime)
  }
}

function callSheetTriggers(e, sheetName, triggers) {
  if (Object.keys(triggers).indexOf(sheetName) !== -1) {
    triggers[sheetName](e)
  }
}

function callCellTriggers(e) {
  //log("Entering callCellTriggers")
  const spreadsheet = e.source
  const sheet = e.range.getSheet()
  if (sheetNamesWithNoCellTriggers.indexOf(sheet.getName()) > -1) return
  const allNamedRanges = sheet.getNamedRanges().filter(namedRange => 
    namedRange.getName().indexOf("code") === 0 && rangesOverlap(e.range, namedRange.getRange())
  )
  //log("allNamedRanges",allNamedRanges.length)
  if (allNamedRanges.length === 0) return

  const isMultiColumnRange = (e.range.getWidth() > 1)
  const isMultiRowRange = (e.range.getHeight() > 1)
  let triggeredRows = {}
  let ranges = []

  // If we're working with multiple rows, set up the system to prevent running some code from 
  // running multiple times per row.
  if (isMultiRowRange) {
    Object.keys(rangeTriggers).forEach(key => {
      if (rangeTriggers[key].callOncePerRow) triggeredRows[key] = []
    })
    //log(JSON.stringify(triggeredRows))
  }

  // If we're working with multiple rows or columns, collect all the 1-cell ranges we'll be looking at.
  if (isMultiRowRange || isMultiColumnRange) {
    //log("Rows:", e.range.getRow(), e.range.getLastRow())
    //log("Columns:", e.range.getColumn(), e.range.getLastColumn())
    for (let y = e.range.getColumn(); y <= e.range.getLastColumn(); y++) {
      for (let x = e.range.getRow(); x <= e.range.getLastRow(); x++) {
        //log("Added",x,y)
        ranges.push(sheet.getRange(x,y))
      }
    }
  } else {
    ranges.push(e.range)
  }
  //log("Ranges:", ranges.length)
  
  // Proceed through the array of 1-cell ranges
  ranges.forEach(range => {
    // For this 1-cell range, collect all the triggers to be triggered.
    let involvedTriggerNames = []
    allNamedRanges.forEach(namedRange => {
      if (isInRange(range, namedRange.getRange())) {
        //log("Adding " + namedRange.getName() + " as involved named range")
        involvedTriggerNames.push(convertNamedRangeToTriggerName(namedRange))
        //log("Added " + namedRange.getName() + " as involved named range")
      }
    })
    //log("involvedTriggerNames:", involvedTriggerNames.length)

    // Call all the functions for the triggers involved with this 1-cell range
    //log("Range: " + range.getA1Notation())
    involvedTriggerNames.forEach(triggerName => {
      // Check to see if this trigger has a one-call-per-row constraint on it
      //log("Triggering " + triggerName)
      if (triggeredRows[triggerName]) {
        // if it hasn't been triggered for this row, trigger and record it.
        if (triggeredRows[triggerName].indexOf(range.getRow()) === -1) {
          //log("Triggering " + triggerName)
          rangeTriggers[triggerName]["functionCall"](range)
          triggeredRows[triggerName].push(range.getRow())
          //log("Triggered " + triggerName)
        }
      } else {
        //log("Triggering " + triggerName)
        rangeTriggers[triggerName]["functionCall"](range)
        //log("Triggered " + triggerName)
      }
      //log("Triggered " + triggerName)
    })
  }) 
}

function formatAddress(range) {
  const app = SpreadsheetApp
  let backgroundColor = app.newColor()
  if (range.getValue() && range.getValue().trim()) {
    addressParts = parseAddress(range.getValue())
    let formattedAddress = getGeocode(addressParts.geocodeAddress, "formatted_address")
    if (addressParts.parenText) formattedAddress = formattedAddress + " " + addressParts.parenText
    if (formattedAddress.startsWith("Error")) {
      const msg = "Address " + formattedAddress
      range.setNote(msg)
      app.getActiveSpreadsheet().toast(msg)
      backgroundColor.setRgbColor(errorBackgroundColor)
    } else {
      range.setValue(formattedAddress)
      range.setNote("")
      backgroundColor.setRgbColor(defaultBackgroundColor)
    } 
  } else {
    range.setNote("")
    backgroundColor.setRgbColor(defaultBackgroundColor)
  }
  range.setBackgroundObject(backgroundColor.build())
}

function fillRequestCells(range) {
  if (range.getValue()) {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const tripRow = getFullRow(range)
    const tripValues = getRangeValuesAsTable(tripRow)[0]
    const filter = function(row) { return row["Customer Name and ID"] === tripValues["Customer Name and ID"] }
    const customerRow = findFirstRowByHeaderNames(ss.getSheetByName("Customers"), filter)
    let valuesToChange = {}
    valuesToChange["Customer ID"] = customerRow["Customer ID"]
    if (tripValues["PU Address"] == '') { valuesToChange["PU Address"] = customerRow["Home Address"] }
    if (tripValues["DO Address"] == '') { valuesToChange["DO Address"] = customerRow["Default Destination"] }
    if (tripValues["Service ID"] == '') { valuesToChange["Service ID"] = customerRow["Default Service ID"] }
    setValuesByHeaderNames([valuesToChange], tripRow)
    if (valuesToChange["PU Address"] || valuesToChange["DO Address"]) { fillHoursAndMiles(range) }
  }
}

function fillHoursAndMiles(range) {
  const tripRow = getFullRow(range)
  const tripValues = getRangeValuesAsTable(tripRow)[0]
  if (tripValues["PU Address"] && tripValues["DO Address"]) {
    const PUAddress = parseAddress(tripValues["PU Address"]).geocodeAddress
    const DOAddress = parseAddress(tripValues["DO Address"]).geocodeAddress
    const tripEstimate = getTripEstimate(PUAddress, DOAddress, "milesAndDays")
    setValuesByHeaderNames([{"Est Hours": tripEstimate.days, "Est Miles": tripEstimate.miles}], tripRow)
    if (tripEstimate["days"]) {
      SpreadsheetApp.getActiveSpreadsheet().toast("Travel estimate saved")
    }
  } else {
    setValuesByHeaderNames([{"Est Hours": "", "Est Miles": ""}], tripRow)
  }
}

/**
 * Manage setup of a new customer record. The goals here are to:
 * - Trim the customer name as needed 
 * _ Generate a customer ID when it's missing and there's a first and last name present
 * - Autofill the "Customer Name and ID" field when the first name, last name, and ID are present. 
 *   This will be the field used to identify the customer in trip records
 * - Keep track of the current highest customer ID in document properties, seeding data when needed
 */
function setCustomerKey(range) {
  const customerRow = getFullRow(range)
  const customerValues = getRangeValuesAsTable(customerRow)[0]
  let newValues = {}
  if (customerValues["Customer First Name"] && customerValues["Customer Last Name"]) {
    let lastCustomerID = getDocProp("lastCustomerID_")
    if (!Number.isFinite(lastCustomerID)) {
      const sheet = range.getSheet()
      const idColumn = getColumnIndexFromHeaderName("Customer ID",range) + 1
      const idRange = sheet.getRange(1, idColumn, sheet.getLastRow())
      let maxID = getMaxValueInRange(idRange)
      lastCustomerID = Number.isFinite(maxID) ? maxID : 1
    }
    let nextCustomerID = Math.ceil(lastCustomerID) + 1
    // There is no ID. Set one and update the lastCustomerID property
    if (!customerValues["Customer ID"]) {
      newValues["Customer ID"] = nextCustomerID
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
      setDocProp("lastCustomerID_", nextCustomerID)
    // There is an ID value present, and it's numeric. 
    // Update the lastCustomerID property if the new ID is greater than the current lastCustomerID property
    } else if (Number.isFinite(customerValues["Customer ID"])) { 
      newValues["Customer ID"] = (customerValues["Customer ID"])
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
      if (customerValues["Customer ID"] >= nextCustomerID) { setDocProp("lastCustomerID_", customerValues["Customer ID"]) }
    // There is an ID value, and it's not numeric. Allow this, but don't track it as the lastCustomerID
    } else { 
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
    }
    setValuesByHeaderNames([newValues], customerRow)
  }
}

function updateTripTimes(range) {
  const tripRow = getFullRow(range)
  const tripValues = getRangeValuesAsTable(tripRow)[0]
  let newValues = {}
  if (isFinite(tripValues["Est Hours"])) {
    const estMilliseconds = timeOnly(tripValues["Est Hours"])
    const estHours = estMilliseconds / 3600000
    const padding = getDocProp("tripPaddingPerHourInMinutes") * estHours * 60000
    const dwellTime = getDocProp("dwellTimeInMinutes") * 60000
    const journeyTime = estMilliseconds + padding + dwellTime
    if (tripValues["PU Time"] && !tripValues["DO Time"]) {
      newValues["DO Time"] = timeAdd(tripValues["PU Time"], journeyTime)
    }
    if (tripValues["DO Time"] && !tripValues["PU Time"]) {
      newValues["PU Time"] = timeAdd(tripValues["DO Time"], -journeyTime)
    }
    setValuesByHeaderNames([newValues], tripRow)
  }
}

function updateTripVehicleOnEdit(range) {
  if (range.getValue()) {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const tripRow = getFullRow(range)
    const tripValues = getRangeValuesAsTable(tripRow)[0]
    if (!tripValues["Vehicle ID"]) {
      const filter = function(row) { return row["Driver ID"] === tripValues["Driver ID"] && row["Default Vehicle ID"] }
      const driverRow = findFirstRowByHeaderNames(ss.getSheetByName("Drivers"), filter)
      if (driverRow) {
        let valuesToChange = {}
        valuesToChange["Vehicle ID"] = driverRow["Default Vehicle ID"]
        setValuesByHeaderNames([valuesToChange], tripRow)
      }
    }
  }
  
}

function scanForDuplicates(range) {
  thisValue = range.getValue()
  const thisRowNumber = range.getRow()
  const fullRange = range.getSheet().getRange(1, range.getColumn(), range.getSheet().getLastRow())
  const values = fullRange.getValues().flat()

  let duplicateRows = []
  values.forEach((value, i) => {
    if (value == thisValue && (i + 1) != thisRowNumber) duplicateRows.push(i + 1)
  })
  if (duplicateRows.length == 1) range.setNote("This value is already used in row "  + duplicateRows[0]) 
  if (duplicateRows.length > 1)  range.setNote("This value is already used in rows " + duplicateRows.join(", ")) 
  if (duplicateRows.length == 0) range.clearNote()
}

function updatePropertiesOnEdit(e) {
  updateProperties(e)
}

function updateRunsOnEdit(e) {
  updateRuns(e)
}