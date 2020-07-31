const sheetTriggers = {
  "Document Properties":   updatePropertiesOnEdit
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
  }
}

/**
 * The event handler triggered when editing the spreadsheet.
 * @param {event} e The onEdit event.
 */
function onEdit(e) {
  const startTime = new Date()
  const sheetName = e.range.getSheet().getName()
  
  if (updateSheetHeaderRow(e, sheetname)) return
  callSheetTriggers(e, sheetname)  
  callCellTriggers(e)
  
  log("onEdit duration:",(new Date()) - startTime)
}

function updateSheetHeaderRow(e, sheetname) {
  // Call special code that's just for data headers, if that's what's being edited
  if (e.range.getRow() === 1 && e.range.getLastRow() === 1 && sheetsWithHeaders.indexOf(sheetName) !== -1) {
    storeHeaderInformation(e)
    return true
  } else {
    return false
  }
}

function callSheetTriggers(e, sheetname) {
  if (Object.keys(sheetTriggers).indexOf(sheetName) !== -1) {
    sheetTriggers[sheetName](e)
  }
}

function callCellTriggers(e) {
  const spreadsheet = e.source
  const sheet = e.range.getSheet()
  const allNamedRanges = spreadsheet.getNamedRanges().filter(nr => nr.getName().indexOf("code") === 0)
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
    const tripValues = getValuesByHeaderNames(["Customer Name and ID","PU Address","DO Address","Service ID"], tripRow)
    const customerRow = findFirstRowByHeaderNames({"Customer Name and ID": tripValues["Customer Name and ID"]}, ss.getSheetByName("Customers"))
    const customerAddresses = getValuesByHeaderNames(["Customer ID","Home Address","Default Destination","Default Service ID"], customerRow)
    let valuesToChange = {}
    valuesToChange["Customer ID"] = customerAddresses["Customer ID"]
    if (tripValues["PU Address"] == '') { valuesToChange["PU Address"] = customerAddresses["Home Address"] }
    if (tripValues["DO Address"] == '') { valuesToChange["DO Address"] = customerAddresses["Default Destination"] }
    if (tripValues["Service ID"] == '') { valuesToChange["Service ID"] = customerAddresses["Default Service ID"] }
    setValuesByHeaderNames(valuesToChange, tripRow)
    if (valuesToChange["PU Address"] || valuesToChange["DO Address"]) { fillHoursAndMiles(range) }
  }
}

function fillHoursAndMiles(range) {
  const tripRow = getFullRow(range)
  const values = getValuesByHeaderNames(["PU Address", "DO Address"], tripRow)
  let tripEstimate
  if (values["PU Address"] && values["DO Address"]) {
    tripEstimate = getTripEstimate(values["PU Address"], values["DO Address"], "milesAndDays")
    setValuesByHeaderNames({"Est Hours": tripEstimate["days"], "Est Miles": tripEstimate["miles"]}, tripRow)
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
  const customerValues = getValuesByHeaderNames(["Customer First Name", "Customer Last Name", "ID", "Customer Name and ID"], customerRow)
  let newValues = {}
  if (customerValues["Customer First Name"] && customerValues["Customer Last Name"]) {
    const lastCustomerID = getDocProp("lastCustomerID_")
    let nextCustomerID = ((lastCustomerID && (+lastCustomerID)) ? (Math.ceil(+lastCustomerID) + 1) : 1 )
    // There is no ID. Set one and update the lastCustomerID property
    if (!customerValues["Customer ID"]) {
      newValues["Customer ID"] = nextCustomerID
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
      setDocProp("lastCustomerID_", nextCustomerID)
    // There is an ID value present, and it's numeric. 
    // Update the lastCustomerID property if the new ID is greater than the current lastCustomerID property
    } else if (+customerValues["Customer ID"]) { 
      newValues["Customer ID"] = (+customerValues["ID"])
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
      if ((+customerValues["Customer ID"]) >= nextCustomerID) { setDocProp("lastCustomerID_", customerValues["ID"]) }
    // There is an ID value, and it's not numeric. Allow this, but don't track it as the lastCustomerID
    } else { 
      newValues["Customer First Name"] = customerValues["Customer First Name"].trim()
      newValues["Customer Last Name"] = customerValues["Customer Last Name"].trim()
      newValues["Customer Name and ID"] = getCustomerNameAndId(newValues["Customer First Name"], newValues["Customer Last Name"], newValues["Customer ID"])
    }
    setValuesByHeaderNames(newValues, customerRow)
  }
}

function scanForDuplicates(range) {
  const thisRowNumber = range.getRow()
  const fullRange = e.range.getSheet().getRange(1, e.range.getColumn(), e.range.getSheet().getLastRow())
  const values = fullRange.getValues().map(row => row[0])
  let duplicateRows = []
  values.forEach((value, i) => {
    if (value == e.value && (i + 1) != thisRowNumber) duplicateRows.push(i + 1)
  })
  if (duplicateRows.length == 1) range.setNote("This value is already used in row "  + duplicateRows[0]) 
  if (duplicateRows.length > 1)  range.setNote("This value is already used in rows " + duplicateRows.join(", ")) 
  if (duplicateRows.length == 0) range.clearNote()
}

function updatePropertiesOnEdit(e) {
  updateProperties(e)
}