/* FreeTikz, written by Chris Heunen <chris.heunen@ed.ac.uk>, 2018 */

/* PARAMETERS */

var settings = {
  strokeWidth: 2, // how wide strokes in html svg element are
  smoothingFactor: 6, // how much strokes in html svg element are dynamically smoothed out while drawing
  segmentationThreshold: 70.0, // how close two segments have to be to be considered part of one shape
  convexityThreshold: 0.5, // how nonconcave a shape has to be to be considered convex
  openThreshold: 0.1, // how close endpoints of a path have to be for it to be considered a closed shape
  connectThreshold: 50.0, // how close a wire has to be to a shape to connect to it
  angleThreshold: 5.0, // how close an segment of a wire needs to be to a right angle
  angleSnapThreshold: 45, // wire angles will be rounded to multiples of this many degrees
  grid: 0.5 // how large the grid is that coordinates are snapped to
}
/* SMOOTH SVG DRAWING */

var svg = {
  // This will hold document.getElementById('svg'), as well as the following:
  currentPathElement: null,
  currentPathString: null
}
var latex = null // <textarea> element for output
var d3svg = null // d3 reference for the svg object
var buffer = [] // holds points for smoothing

/**
 * Initialises the svg and d3 handlers
 */
function setup () {
  latex = document.getElementById('latex')

  d3svg = d3.select('#svg')
  svg = document.getElementById('svg')
  svg.rect = svg.getBoundingClientRect()

  svg.addEventListener('touchstart', function (e) {
    e.stopPropagation()
    e.preventDefault()
    pointerDown(e)
  })
  svg.addEventListener('mousedown', pointerDown)

  svg.addEventListener('touchmove', function (e) {
    e.stopPropagation()
    e.preventDefault()
    pointerMove(e)
  })
  svg.addEventListener('mousemove', pointerMove)

  svg.addEventListener('touchend', function (e) {
    e.stopPropagation()
    e.preventDefault()
    pointerUp(e)
  })
  svg.addEventListener('mouseup', pointerUp)
}

/**
 * Handles touchstart and mousedown events
 */
var pointerDown = function (e) {
  if (pencil) {
    svg.currentPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.currentPathElement.setAttribute('fill', 'none')
    svg.currentPathElement.setAttribute('stroke', '#000')
    svg.currentPathElement.setAttribute('stroke-width', settings.strokeWidth)
    buffer = []
    var pt = getMousePosition(e)
    appendToBuffer(pt)
    svg.currentPathString = 'M' + pt.x + ' ' + pt.y
    svg.currentPathElement.setAttribute('d', svg.currentPathString)
    svg.appendChild(svg.currentPathElement)
  } else if (eraser) {
    erase(getMousePosition(e))
  }
}

/**
 * Handles touchmove and mousemove events
 */
var pointerMove = function (e) {
  if (pencil) {
    if (svg.currentPathString) {
      appendToBuffer(getMousePosition(e))
      updateSvgPath()
    }
  } else if (eraser) {
    erase(getMousePosition(e))
  }
}

/**
 * Handles touchend and mouseup events
 */
var pointerUp = function () {
  if (svg.currentPathString) svg.currentPathString = null
  updateLatex()
}

/**
 * Converts screen-origin mouse event to svg-origin mouse event.
 * @returns {Point}
 */
var getMousePosition = function (e) {
  return {
    x: e.pageX - svg.rect.left,
    y: e.pageY - svg.rect.top
  }
}

/**
 * Add point to the line-drawing buffer
 * @param {Point} pt
 */
var appendToBuffer = function (pt) {
  buffer.push(pt)
  while (buffer.length > settings.smoothingFactor) {
    buffer.shift()
  }
}

/**
 * Collect the mean x and y coordinates of the buffer
 * @param {Number} offset Ignore the first `offset` many points in the buffer
 */
var getAveragePoint = function (offset) {
  var len = buffer.length
  // TODO: Understand what happens when this is false
  if (len % 2 === 1 || len >= settings.smoothingFactor) {
    var totalX = 0
    var totalY = 0
    var pt, i
    var count = 0
    for (i = offset; i < len; i++) {
      count++
      pt = buffer[i]
      totalX += pt.x
      totalY += pt.y
    }
    return {
      x: totalX / count,
      y: totalY / count
    }
  }
  return null
}

/**
 * Extend the svg path by adding smooth points from the buffer
 */
var updateSvgPath = function () {
  var pt = getAveragePoint(0)
  if (pt) {
    svg.currentPathString += ' L' + pt.x + ' ' + pt.y
    var tmpPath = ''
    for (var offset = 2; offset < buffer.length; offset += 2) {
      pt = getAveragePoint(offset)
      tmpPath += ' L' + pt.x + ' ' + pt.y
    }
    svg.currentPathElement.setAttribute('d', svg.currentPathString + tmpPath)
  }
}

/* CALCULATE PROPERTIES OF POLYGON FOR CLASSIFICATION */

/**
 * Pull the points from svgPath
 * @param {String} svgPath
 * @returns {List[Point]}
 */
function svgPathToList (svgPath) {
  var src = svgPath.split(/(?=[LM])/)
  var path = []
  for (var i = 0; i < src.length; i++) {
    var seg = src[i].replace(/L /g, '').replace(/M /g, '').replace(/L/g, '').replace(/M/g, '')
    var pointString = seg.split(' ')
    path.push(
      {
        x: parseFloat(pointString[0]),
        y: parseFloat(pointString[1])
      })
    // path.push({ x : parseFloat(point[0]), y : parseFloat(point[1])});
  }
  return path
}

/**
 * Euclidean distance
 * @param {Point} a
 * @param {Point} b
 */
function distance (a, b) {
  var x = b.x - a.x
  var y = b.y - a.y
  return Math.sqrt(x * x + y * y)
}

/**
 * Find bounding box for the given path
 * @param {List[Point]} path
 * @returns {BoundingBox}
 */
function BoundingBox (path) {
  var minX, maxX, minY, maxY
  for (var i = 0; i < path.length; i++) {
    minX = (path[i].x < minX || minX == null) ? path[i].x : minX
    maxX = (path[i].x > maxX || maxX == null) ? path[i].x : maxX
    minY = (path[i].y < minY || minY == null) ? path[i].y : minY
    maxY = (path[i].y > maxY || maxY == null) ? path[i].y : maxY
  }
  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY
  }
}

/**
 * Heuristic for path compactness
 * @param {Number} area
 * @param {Number} perimeter
 * @returns {Number}
 */
function Compactness (area, perimeter) {
  return 2 * Math.sqrt(area * Math.PI) / perimeter
}

/**
 * Heuristic for path eccentricity
 * @param {List[Point]} path
 * @param {Point} centre
 * @returns {Number}
 */
function Eccentricity (path, centre) {
  var centredpath = []
  for (var i = 0; i < path.length; i++) {
    centredpath.push({x: path[i].x - centre.x, y: path[i].y - centre.y})
  }
  var covariance = [0, 0, 0, 0]
  for (i = 0; i < centredpath.length; i++) {
    covariance[0] += centredpath[i].x * centredpath[i].x
    covariance[1] += centredpath[i].x * centredpath[i].y
    covariance[2] += centredpath[i].y * centredpath[i].x
    covariance[3] += centredpath[i].y * centredpath[i].y
  }
  var b = Math.sqrt(Math.pow(covariance[0] + covariance[3], 2) - 4 * (covariance[0] * covariance[3] - Math.pow(covariance[1], 2)))
  var lambda1 = covariance[0] + covariance[3] + b
  var lambda2 = covariance[0] + covariance[3] - b
  return lambda2 / lambda1
}

/**
 * Heuristic for Rectangularity (spikiness)
 * @param {BoundingBox} boundingbox
 * @param {Number} area
 * @returns {Number}
 */
function Rectangularity (boundingbox, area) {
  var boundarea = (boundingbox.maxX - boundingbox.minX) * (boundingbox.maxY - boundingbox.minY)
  return area / boundarea
}

/**
 * Heuristic for circularity
 * @param {List[Number, Number]} path
 * @param {[Number, Number]} centre
 * @param {Number} area
 * @returns {Number}
 */
function Circularity (path, centre, area) {
  var furthestdistance = 0
  for (var i = 0; i < path.length; i++) {
    var d = distance(path[i], centre)
    if (d > furthestdistance) furthestdistance = d
  }
  var circlearea = Math.PI * Math.pow(furthestdistance, 2)
  return area / circlearea
}

/**
 * Aspect ration
 * @param {Boundingbox} boundingbox
 * @returns {Number}
 */
function AspectRatio (boundingbox) {
  return (boundingbox.maxX - boundingbox.minX) / (boundingbox.maxY - boundingbox.minY)
}

/**
 * Convert path to d3 standard (pairs of numbers)
 * @param {List[Point]}
 * @returns {List[[Number, Number]]}
 */
function pathToD3 (path) {
  return path.map(function (p) { return [p.x, p.y] })
}

/**
 * Convert d3 path (pairs of numbers) to a list of points
 * @param {List[[Number, Number]]}
 * @returns {List[Point]}
 */
function d3PathToPoints (path) {
  return path.map(function (p) { return {x: p[0], y: p[1]} })
}

/**
 * Heuristic for convexity
 * @param {List[Point]} path
 * @param {Number} area
 * @param {Number} threshold
 * @returns {Number}
 */
function isConvex (path, area, threshold) {
  var convexhullArea = d3.polygonArea(d3.polygonHull(pathToD3(path)))
  return ((area / convexhullArea) >= threshold)
}

/**
 * Heuristic for whether the path is considered open
 * @param {List[Point]} path
 * @param {Number} perimeter
 * @param {Number} threshold
 * @returns {Boolean}
 */
function isOpen (path, perimeter, threshold) {
  var ratio = distance(path[0], path[path.length - 1]) / perimeter
  return (ratio > threshold)
}

/**
 * Find orientation using the furthest point from the centre of the path
 * @param {List[Point]} path
 * @param {Point} centre
 * @returns {String}
 */
function Orientation (path, centre) {
  var corner = path[0]
  var furthestdistance = distance(corner, centre)
  for (var i = 1; i < path.length; i++) {
    var d = distance(path[i], centre)
    if (d > furthestdistance) { furthestdistance = d; corner = path[i] }
  }
  var dx = corner.x - centre.x
  var dy = corner.y - centre.y
  if (dx < 0 && dy < 0) return ', hvflip'
  if (dx >= 0 && dy < 0) return ', hflip'
  if (dx >= 0 && dy >= 0) return ''
  return ', vflip'
}

/* CLASSIFY SHAPES */

/**
 * For each path create the corresponding tikz entry, and output it to the screen
 */
function updateLatex () {
  var pathlist = []
  d3svg.selectAll('path').each(function (d, i) {
    var p = svgPathToList(this.getAttribute('d'))
    if (p.length > 1) pathlist.push(p)
  })
  var wires = []
  var dots = []
  var morphisms = []
  var toPoint = p => ({x: p[0], y: p[1]})
  for (var i = 0; i < pathlist.length; i++) {
    /* calculate properties of polygon */
    var path = pathlist[i]
    var d3Path = pathToD3(path)
    var boundingbox = BoundingBox(path)
    var centre = toPoint(d3.polygonCentroid(d3Path))
    var area = Math.abs(d3.polygonArea(d3Path))
    var perimeter = d3.polygonLength(d3Path)
    var compactness = Compactness(area, perimeter)
    var eccentricity = Eccentricity(path, centre)
    var rectangularity = Rectangularity(boundingbox, area)
    var circularity = Circularity(path, centre, area)
    var aspectratio = AspectRatio(boundingbox)
    var convex = isConvex(path, area, settings.convexityThreshold)
    var open = isOpen(path, perimeter, settings.openThreshold)
    var orientation = Orientation(path, centre)

    /* classify the shape */
    /* This is a hack, and should be done by training a Support Vector Machine instead */
    if (open || !convex) {
      wires.push(path)
    } else if (circularity > 0.5) {
      dots.push([path, centre])
    } else if (rectangularity > 0.5 && circularity < 0.5) {
      morphisms.push([path, centre, orientation])
    } else {
      wires.push(path)
    }
  }

  var annotatedwires = connect(wires, dots, morphisms)
  latex.value = generateLatex(dots, morphisms, annotatedwires)
}

/* GENERATE LATEX CODE */

/**
 * Try to find any existing structure for the point to connect to
 * @param {Point} point The point we are investigating
 * @param {List[[Polygon, Point]]} dots
 * @param {List[[Polygon, Point]]} morphisms
 * @returns {String}
 */
function bestConnection (point, dots, morphisms) {
  var bestDistance = settings.connectThreshold
  var bestConnection = ''
  for (var d = 0; d < dots.length; d++) {
    if (d3.polygonContains(dots[d][0], point)) return 'd' + d + '.center'
    var distDots = distance(dots[d][1], point)
    if (distDots < bestDistance) {
      bestDistance = distDots
      bestConnection = 'd' + d + '.center'
    }
  }
  for (var m = 0; m < morphisms.length; m++) {
    if (d3.polygonContains(morphisms[m][0], point)) return 'm' + m
    var distMorphisms = distance(morphisms[m][1], point)
    if (distMorphisms < bestDistance) {
      bestDistance = distMorphisms
      bestConnection = 'm' + m
    }
  }
  if (bestDistance < settings.connectThreshold) return bestConnection
  else return latexCoords(point)
}

/**
 * Connect the wires to the given dots and morphisms
 * @param {List[Point]} wires
 * @param {List[[Polygon, Point]]} dots
 * @param {List[[Polygon, Point]]} morphisms
 * @returns {List[[Wire, Point, Point]}
 */
function connect (wires, dots, morphisms) {
  var annotatedwires = []
  var wire, begin, end
  for (var i = 0; i < wires.length; i++) {
    wire = wires[i]
    begin = bestConnection(wire[0], dots, morphisms)
    end = bestConnection(wire[wire.length - 1], dots, morphisms)
    annotatedwires.push([wire, begin, end])
  }
  return annotatedwires
}

/**
 * Rounds @1 to the nearest multiple of @2
 * @param {Number} precise
 * @param {Number} multiples
 * @returns {Number}
 */
function round (precise, multiples) {
  var base = Math.abs(precise)
  var mult = Math.abs(multiples)
  var mod = (base % mult)
  if (mod <= (mult / 2)) {
    base -= mod
  } else {
    base += (mult - mod)
  }
  return (precise < 0) ? -base : base
}

/**
 * Convert a point into its latex coordinates
 * @param {Point} point
 */
function latexCoords (point) {
  return round(parseFloat(point.x * 10 / svg.getBoundingClientRect().width), settings.grid).toFixed(2) * 1 +
    ', ' + round(parseFloat(10 - point.y * 10 / svg.getBoundingClientRect().height), settings.grid).toFixed(1) * 1
}

/**
 * Rounds the angle to a multiple of the angleSnapThreshold
 * @param {Number} angle
 * @returns {Number}
 */
function snapAngle (angle) {
  var snapangle = round(parseFloat(angle), settings.angleSnapThreshold)
  if (snapangle === -180) snapangle = 180
  if (snapangle === 0) snapangle = 0 // Force to +0, not -0
  return snapangle
}

/**
 * Is the angle within a tolerance of directly horizontal or vertical
 * @param {Number} angle
 * @returns {Boolean}
 */
function isHorizontalOrVertical (angle) {
  var snapangle = Math.abs(angle) % 90
  var snap = (snapangle < settings.angleThreshold) || (snapangle > 90 - settings.angleThreshold)
  return snap
}

/**
 * Angle of the second argument from the first
 * @param {Point} begin
 * @param {Point} end
 * @returns {Number}
 */
function Angle (begin, end) {
  var dx = end.x - begin.x
  var dy = end.y - begin.y
  var angle = Math.atan2(-dy, dx)
  return angle * 180.0 / Math.PI
}

/**
 * Render the dot to svg
 * @param {Point} point
 * @param {String} color
 */
function showDot (point, color) {
  var svgns = 'http://www.w3.org/2000/svg'
  var dot = document.createElementNS(svgns, 'circle')
  dot.setAttributeNS(null, 'cx', point.x)
  dot.setAttributeNS(null, 'cy', point.y)
  dot.setAttributeNS(null, 'r', 2)
  dot.setAttributeNS(null, 'style', 'fill:' + color + '; stroke: black; stroke-width: 1px;')
  svg.appendChild(dot)
}

/**
 * Simplifies the wire, via our own method
 * @param {Wire} wire
 * @returns {Wire}
 */
function simplifyWire (wire) {
  // for (var i=0; i<wire.length; i++) showDot(wire[i],'blue');
  // var s = simplify(wire, 30, true);
  // for (var i=0; i<s.length; i++) showDot(s[i], 'red');

  // angledWire contains [point, angleFromLast, angleToNext]
  var angledwire = [[wire[0], 999, snapAngle(Angle(wire[0], wire[1]))]]
  for (var i = 1; i < wire.length - 2; i++) {
    angledwire.push([wire[i], snapAngle(Angle(wire[i], wire[i - 1])), snapAngle(Angle(wire[i], wire[i + 1]))])
    // showDot(wire[i],'blue');
  }
  angledwire.push([wire[wire.length - 1], snapAngle(Angle(wire[wire.length - 1], wire[wire.length - 2])), 999])

  var simplewire = [angledwire[0]]
  // insert points with horizontal or vertical tangent that are not in the list
  // take out points that do not have a nearly horizontal or vertical tangent
  for (var i = 1; i < angledwire.length - 2; i++) {
    if (isHorizontalOrVertical(angledwire[i][1])) {
      simplewire.push(angledwire[i])
      // showDot(angledwire[i][0],'green');
    }
  }
  simplewire.push(angledwire[angledwire.length - 1])

  // delete 'pass-through' points
  var sparsewire = [simplewire[0]]
  // showDot(sparsewire[0][0],'red');
  for (var i = 1; i < simplewire.length - 1; i++) {
    // console.log(simplewire[i][1] + "   " + simplewire[i-1][2]);
    if (Math.abs(simplewire[i][1] - simplewire[i - 1][2]) !== 180) {
      sparsewire.push(simplewire[i])
      // showDot(simplewire[i][0], 'red');
    }
  }
  var last = sparsewire[sparsewire.length - 1]
  var final = simplewire[simplewire.length - 1]
  if (Math.abs(final[1] - last[2]) === 180 && sparsewire.length > 1) { sparsewire.pop() }
  sparsewire.push(final)
  // showDot(final[0],'red');
  return sparsewire
}

/**
 * TODO: Annotate this
 */
function anchor (node, angle, point, morphisms, wires) {
  if (node[0] === 'm') {
    var morphismnr = node.substr(1, node.length - 1)
    var morphism = morphisms[morphismnr]
    var morphismcentre = morphism[1]

    var nrNorthConnections = 0
    var nrSouthConnections = 0
    var wirepoint
    for (var i = 0; i < wires.length; i++) {
      if (wires[i][1] === node) {
        wirepoint = wires[i][0][0]
        if (wirepoint[1] < morphismcentre[1]) nrNorthConnections++
        else nrSouthConnections++
      }
      if (wires[i][2] === node) {
        wirepoint = wires[i][0][wires[i].length - 1]
        if (wirepoint[1] < morphismcentre[1]) nrNorthConnections++
        else nrSouthConnections++
      }
    }

    if (nrNorthConnections === 1 && point.y <= morphismcentre.y) return node + '.north'
    if (nrSouthConnections === 1 && point.y >= morphismcentre.y) return node + '.south'

    if (nrNorthConnections === 2 && point.y <= morphismcentre.y) {
      if (point.x <= morphismcentre.x) return node + '.north west'
      else return node + '.north east'
    }
    if (nrSouthConnections === 2 && point.y >= morphismcentre.y) {
      if (point.x <= morphismcentre.x) return node + '.south west'
      else return node + '.south east'
    }

    var morphismbbox = BoundingBox(morphism[0])
    var width = morphismbbox.maxX - morphismbbox.minX

    if (nrNorthConnections === 3 && point.y <= morphismcentre.y) {
      if (point.x < morphismcentre.x - width / 6) return node + '.north west'
      else if (point.x > morphismcentre.x + width / 6) return node + '.north east'
      else return node + '.north'
    }
    if (nrSouthConnections === 3 && point.y >= morphismcentre.y) {
      if (point.x < morphismcentre.x - width / 6) return node + '.south west'
      else if (point.x > morphismcentre.x + width / 6) return node + '.south east'
      else return node + '.south'
    }

    return node + '.' + angle
  }
  return node
}

/**
 * Render a wire as tikz
 * @param {Wire} wire
 * @param {Node} begin
 * @param {Node} end
 * @param {List[Morphism]} morphisms
 * @param {List[Wire]} wires
 * @returns {String}
 */
function latexWire (wire, begin, end, morphisms, wires) {
  var simplewire = simplifyWire(wire)
  var latex = '  \\draw ('
  latex += anchor(begin, simplewire[0][2], simplewire[0][0], morphisms, wires) + ')'
  for (var i = 1; i < simplewire.length - 1; i++) {
    latex += ' to[out=' + simplewire[i - 1][2] + ', in=' + simplewire[i][1] + '] ('
    latex += latexCoords(simplewire[i][0])
    // showDot(simplewire[i][0],'red');
    latex += ')'
  }
  latex += ' to[out=' + simplewire[simplewire.length - 2][2] + ', in=' + simplewire[simplewire.length - 1][1] + '] ('
  latex += anchor(end, simplewire[simplewire.length - 1][1], simplewire[simplewire.length - 1][0], morphisms, wires)
  latex += ');\n'
  return latex
}

/**
 * Creates the tikz output, used inside updateLatex
 */
function generateLatex (dots, morphisms, annotatedwires) {
  var latex = '\\documentclass{standalone}\n\\usepackage{freetikz}\n\\begin{document}\n\\begin{tikzpicture}\n'
  for (var i = 0; i < dots.length; i++) {
    var dot = dots[i][1]
    latex += '  \\node[dot] (d' + i + ') at (' + latexCoords(dot) + ') {};\n'
  }
  for (var i = 0; i < morphisms.length; i++) {
    var morphism = morphisms[i]
    latex += '  \\node[morphism' + morphism[2] + '] (m' + i + ') at (' + latexCoords(morphism[1]) + ') {m' + i + '};\n'
  }
  for (var i = 0; i < annotatedwires.length; i++) {
    var annotatedwire = annotatedwires[i]
    var wire = annotatedwire[0]
    var begin = annotatedwire[1]
    var end = annotatedwire[2]
    latex += latexWire(wire, begin, end, morphisms, annotatedwires)
  }
  latex += '\\end{tikzpicture}\n\\end{document}'
  return latex
}

/* USER INTERFACE */

var pencil = true
var eraser = false

/**
 * Setup for the toolbar element
 */
function toolbar () {
  pencil = document.getElementById('switch_pencil').checked
  eraser = document.getElementById('switch_eraser').checked
}

/**
 * Event handler for the erase
 */
function erase (pt) {
  var path = document.elementFromPoint(pt.x, pt.y)
  if (path.tagName === 'path') {
    path.remove()
    updateLatex()
  }
}

// Register undo event with d3
d3.select('body').on('keydown', function () { if (d3.event.keyCode === 90) undo() })

/**
 * Handler for the undo action
 */
function undo () {
  d3.select('#svg>path:last-child').remove()
  updateLatex()
}
