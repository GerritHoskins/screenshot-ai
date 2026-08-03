# Screenshot Annotations - Implementation Plan

**Feature:** Screenshot Annotations  
**Priority:** Medium (Enhancement)  
**Estimated Effort:** 3-5 days  
**Status:** Planning

---

## 🎯 Overview

Allow users to annotate screenshots before AI analysis by drawing, highlighting, and adding text notes. Annotations help users:
- Highlight specific areas for AI attention
- Add context/comments directly on the image
- Draw attention to bugs or design issues
- Create visual notes before analysis

---

## 📋 Requirements

### Functional Requirements

1. **Drawing Tools**
   - Freehand pen/marker tool
   - Highlighter tool (semi-transparent)
   - Shapes: rectangle, circle, arrow, line
   - Text annotations
   - Eraser tool

2. **Annotation Management**
   - Undo/redo functionality
   - Clear all annotations
   - Toggle annotation visibility
   - Save annotations with screenshot

3. **Visual Customization**
   - Color picker for drawing tools
   - Line thickness/brush size selector
   - Font size for text annotations
   - Opacity control for highlighter

4. **Integration**
   - Annotations appear after capture, before analysis
   - Annotated image passed to AI analysis
   - Annotations preserved in history
   - Export annotated images

### Non-Functional Requirements

- **Performance:** Smooth drawing at 60fps
- **Storage:** Efficient annotation data format
- **Compatibility:** Works with existing capture flow
- **Accessibility:** Keyboard shortcuts for tools

---

## 🏗️ Architecture

### Component Structure

```
apps/desktop/src/
  main/
    annotations.ts          # Annotation data management
  renderer/
    annotation.html        # Annotation UI window
    annotation.ts          # Canvas drawing logic
    annotation-toolbar.ts  # Tool selection UI
  preload/
    annotation.ts          # Secure IPC bridge for annotations
```

### Data Flow

```
Capture → Selection → Annotation Window → Annotated Image → Analysis
```

1. User captures screenshot
2. User selects region
3. **NEW:** Annotation window opens with captured image
4. User adds annotations (drawing, text, highlights)
5. Annotations merged with screenshot
6. Annotated image sent to AI analysis
7. Annotations stored with analysis result

---

## 📐 Data Structures

### Annotation Data Model

```typescript
// src/types/annotations.ts

export type AnnotationTool = 
  | 'pen'
  | 'highlighter'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'line'
  | 'text'
  | 'eraser';

export interface AnnotationStyle {
  color: string;        // Hex color (#RRGGBB)
  strokeWidth: number;  // Line thickness (1-20)
  opacity: number;      // 0-1 (for highlighter)
  fontSize?: number;    // For text tool (12-48)
}

export interface Annotation {
  id: string;
  type: AnnotationTool;
  style: AnnotationStyle;
  data: AnnotationData;
  timestamp: number;
}

export type AnnotationData =
  | { type: 'path'; points: Array<{ x: number; y: number }> }  // Pen, highlighter
  | { type: 'shape'; x: number; y: number; width: number; height: number }  // Rectangle, circle
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }  // Line, arrow
  | { type: 'text'; x: number; y: number; text: string };  // Text annotation

export interface AnnotationState {
  annotations: Annotation[];
  currentTool: AnnotationTool;
  currentStyle: AnnotationStyle;
  history: {
    undo: Annotation[][];
    redo: Annotation[][];
  };
}
```

### Storage Format

**Option A: Separate JSON (Recommended)**
- Store annotations as JSON alongside image
- Allows editing annotations later
- Smaller file size
- Easy to version control

**Option B: Embedded in Image**
- Merge annotations into PNG/JPEG
- Single file, simpler storage
- Cannot edit after saving
- Larger file size

**Recommendation:** Option A (separate JSON) for flexibility

---

## 🎨 UI/UX Design

### Annotation Window Layout

```
┌─────────────────────────────────────────┐
│ [Toolbar]                               │
├─────────────────────────────────────────┤
│                                         │
│         [Canvas Area]                   │
│     (Screenshot + Annotations)         │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│ [Color] [Size] [Opacity] [Undo] [Redo] │
│ [Clear]                    [Done] [Skip]│
└─────────────────────────────────────────┘
```

### Toolbar Tools

1. **Pen** - Freehand drawing
2. **Highlighter** - Semi-transparent overlay
3. **Rectangle** - Draw rectangles
4. **Circle** - Draw circles
5. **Arrow** - Point to specific areas
6. **Line** - Straight lines
7. **Text** - Add text labels
8. **Eraser** - Remove annotations

### Controls

- **Color Picker:** Click to open color palette
- **Brush Size:** Slider (1-20px)
- **Opacity:** Slider (0-100%, for highlighter)
- **Undo/Redo:** Keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- **Clear All:** Remove all annotations
- **Done:** Proceed to analysis
- **Skip:** Skip annotations, use original image

---

## 🔧 Implementation Phases

### Phase 1: Core Annotation Infrastructure (Day 1)

**Goal:** Basic drawing capability

**Tasks:**
- [ ] Create annotation window (`annotation.html`, `annotation.ts`)
- [ ] Set up canvas for drawing
- [ ] Implement pen tool (freehand drawing)
- [ ] Implement basic color picker
- [ ] Implement brush size selector
- [ ] Add undo/redo functionality
- [ ] Create annotation data model (`src/types/annotations.ts`)
- [ ] Create annotation manager (`apps/desktop/src/main/annotations.ts`)

**Deliverables:**
- Annotation window opens after capture
- User can draw on screenshot
- Annotations stored in memory
- Undo/redo works

**Files to Create:**
- `apps/desktop/src/renderer/annotation.html`
- `apps/desktop/src/renderer/annotation.ts`
- `apps/desktop/src/preload/annotation.ts`
- `apps/desktop/src/main/annotations.ts`
- `src/types/annotations.ts`

**Files to Modify:**
- `apps/desktop/src/main/capture.ts` - Open annotation window after selection
- `apps/desktop/src/main/index.ts` - Handle annotation completion

---

### Phase 2: Drawing Tools (Day 2)

**Goal:** All drawing tools functional

**Tasks:**
- [ ] Implement highlighter tool (semi-transparent pen)
- [ ] Implement rectangle tool
- [ ] Implement circle tool
- [ ] Implement line tool
- [ ] Implement arrow tool (line with arrowhead)
- [ ] Implement text tool (click to add text)
- [ ] Tool selection UI (toolbar)
- [ ] Tool-specific style controls

**Deliverables:**
- All drawing tools work
- Tool selection persists
- Tool-specific options available

**Files to Modify:**
- `apps/desktop/src/renderer/annotation.ts` - Add tool implementations
- `apps/desktop/src/renderer/annotation.html` - Add toolbar UI

---

### Phase 3: Advanced Features (Day 3)

**Goal:** Polish and advanced functionality

**Tasks:**
- [ ] Implement eraser tool
- [ ] Add opacity control (for highlighter)
- [ ] Add font size selector (for text)
- [ ] Implement "Clear All" functionality
- [ ] Add annotation visibility toggle
- [ ] Improve color picker (palette + custom colors)
- [ ] Add keyboard shortcuts
- [ ] Smooth drawing (optimize canvas rendering)

**Deliverables:**
- All tools polished
- Smooth drawing experience
- Keyboard shortcuts work
- All controls functional

**Files to Modify:**
- `apps/desktop/src/renderer/annotation.ts` - Advanced features
- `apps/desktop/src/renderer/annotation.html` - Enhanced UI

---

### Phase 4: Integration & Storage (Day 4)

**Goal:** Integrate with analysis flow and persist annotations

**Tasks:**
- [ ] Merge annotations with screenshot (create final image)
- [ ] Pass annotated image to analysis service
- [ ] Store annotations with analysis result
- [ ] Load annotations from history
- [ ] Export annotated images
- [ ] Update history UI to show annotations

**Deliverables:**
- Annotations flow through to analysis
- Annotations saved with results
- Can view/edit annotations from history
- Can export annotated images

**Files to Create:**
- `src/utils/annotation-renderer.ts` - Merge annotations with image

**Files to Modify:**
- `apps/desktop/src/main/capture.ts` - Integration point
- `apps/desktop/src/main/index.ts` - Handle annotated images
- `apps/desktop/src/main/analysis.ts` - Accept annotated images
- `apps/desktop/src/main/history.ts` - Store/load annotations (if exists)

---

### Phase 5: Testing & Polish (Day 5)

**Goal:** Quality assurance and refinement

**Tasks:**
- [ ] Unit tests for annotation data model
- [ ] Unit tests for annotation rendering
- [ ] E2E test for annotation flow
- [ ] Performance testing (large images, many annotations)
- [ ] Accessibility testing (keyboard navigation)
- [ ] UI polish (animations, transitions)
- [ ] Error handling (invalid annotations, corrupted data)
- [ ] Documentation

**Deliverables:**
- Tests pass
- Performance acceptable
- UI polished
- Documentation complete

**Files to Create:**
- `tests/unit/annotations.test.ts`
- `tests/e2e/annotation-flow.test.ts`

---

## 🔌 Integration Points

### 1. Capture Flow Integration

**File:** `apps/desktop/src/main/capture.ts`

```typescript
// After user selects region
ipcMain.once("capture:selection", async (_event, rect: SelectionRect) => {
  cleanup();
  if (rect.w < 2 || rect.h < 2) {
    resolve(null);
    return;
  }
  
  // Get cropped image
  const cropped = await sharp(full)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
  
  // NEW: Open annotation window
  const annotated = await openAnnotationWindow(cropped);
  
  // Use annotated image for analysis
  resolve(annotated || cropped);
});
```

### 2. Annotation Window

**File:** `apps/desktop/src/main/annotations.ts`

```typescript
export async function openAnnotationWindow(
  imageBuffer: Buffer
): Promise<Buffer | null> {
  const annotationWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "../preload/annotation.js"),
    },
  });

  await annotationWindow.loadFile(
    path.join(__dirname, "../renderer/annotation.html")
  );

  // Send image to annotation window
  annotationWindow.webContents.send("annotation:image", 
    nativeImage.createFromBuffer(imageBuffer).toDataURL()
  );

  return new Promise((resolve) => {
    ipcMain.once("annotation:complete", async (_event, annotations: Annotation[]) => {
      // Merge annotations with image
      const annotatedImage = await renderAnnotations(imageBuffer, annotations);
      resolve(annotatedImage);
    });

    ipcMain.once("annotation:skip", () => {
      resolve(null); // Use original image
    });

    annotationWindow.on("closed", () => {
      resolve(null);
    });
  });
}
```

### 3. Analysis Integration

**File:** `apps/desktop/src/main/index.ts`

```typescript
// Already handles Buffer, no changes needed
const response = await currentService.analyzeScreenshot(
  image, // Can be annotated image
  undefined,
  workspaceRoot
);
```

---

## 🎨 UI Components

### Toolbar Component

```html
<!-- apps/desktop/src/renderer/annotation.html -->
<div class="toolbar">
  <div class="tool-group">
    <button class="tool-btn active" data-tool="pen" title="Pen (P)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="highlighter" title="Highlighter (H)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="rectangle" title="Rectangle (R)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="circle" title="Circle (C)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="arrow" title="Arrow (A)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="line" title="Line (L)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="text" title="Text (T)">
      <svg>...</svg>
    </button>
    <button class="tool-btn" data-tool="eraser" title="Eraser (E)">
      <svg>...</svg>
    </button>
  </div>
  
  <div class="tool-group">
    <input type="color" id="color-picker" value="#ff0000" />
    <input type="range" id="brush-size" min="1" max="20" value="3" />
    <input type="range" id="opacity" min="0" max="100" value="50" />
  </div>
  
  <div class="tool-group">
    <button id="undo" title="Undo (Ctrl+Z)">↶</button>
    <button id="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
    <button id="clear-all">Clear All</button>
  </div>
</div>
```

### Canvas Component

```html
<div class="canvas-container">
  <canvas id="annotation-canvas"></canvas>
  <div id="text-input-overlay" style="display: none;">
    <input type="text" id="text-input" />
  </div>
</div>
```

---

## 🔐 Security Considerations

1. **Canvas Security**
   - No `nodeIntegration` in annotation window
   - Use `contextIsolation` and preload bridge
   - Validate annotation data before rendering

2. **Data Validation**
   - Validate annotation coordinates (within image bounds)
   - Validate annotation types (prevent injection)
   - Sanitize text annotations

3. **IPC Security**
   - Whitelist annotation IPC channels
   - Validate annotation payloads
   - Limit annotation data size

**Files:**
- `src/security/ipc-hardening.ts` - Add annotation channels
- `apps/desktop/src/preload/annotation.ts` - Secure bridge

---

## 📊 Performance Considerations

1. **Canvas Rendering**
   - Use `requestAnimationFrame` for smooth drawing
   - Optimize redraws (only redraw changed areas)
   - Use offscreen canvas for complex operations

2. **Memory Management**
   - Limit annotation history (max 50 undo steps)
   - Clear canvas when window closes
   - Compress annotation data

3. **Image Processing**
   - Use Sharp for efficient image merging
   - Cache rendered annotations
   - Lazy load annotation tools

---

## ♿ Accessibility

1. **Keyboard Navigation**
   - Tab through tools
   - Keyboard shortcuts for all tools
   - Enter to confirm text input
   - Escape to cancel

2. **Screen Reader Support**
   - ARIA labels on all tools
   - Announce tool changes
   - Describe annotations

3. **Visual Indicators**
   - Clear focus indicators
   - Tool selection highlighting
   - High contrast mode support

---

## 🧪 Testing Strategy

### Unit Tests

**File:** `tests/unit/annotations.test.ts`

- Annotation data model validation
- Annotation serialization/deserialization
- Annotation rendering logic
- Undo/redo functionality
- Tool switching logic

### E2E Tests

**File:** `tests/e2e/annotation-flow.test.ts`

- Annotation window opens after capture
- Drawing tools work
- Annotations persist through analysis
- Export annotated images
- Keyboard shortcuts work

### Manual Testing Checklist

- [ ] All drawing tools functional
- [ ] Smooth drawing performance
- [ ] Undo/redo works correctly
- [ ] Annotations merge correctly with image
- [ ] Annotations appear in analysis
- [ ] Annotations saved in history
- [ ] Export works
- [ ] Keyboard shortcuts work
- [ ] Accessibility features work

---

## 📦 Dependencies

### New Dependencies

```json
{
  "dependencies": {
    // No new dependencies needed - use native Canvas API
  },
  "devDependencies": {
    "@types/canvas" // TypeScript types for Canvas API (if needed)
  }
}
```

### Existing Dependencies Used

- `sharp` - Image processing (already in use)
- Electron Canvas API - Native browser Canvas API

---

## 🚀 Deployment Considerations

1. **Backward Compatibility**
   - Existing captures without annotations still work
   - Annotations optional (can skip)
   - Graceful fallback if annotation window fails

2. **Migration**
   - No migration needed (new feature)
   - Existing history entries won't have annotations

3. **Feature Flag**
   - Consider feature flag to enable/disable annotations
   - Allows gradual rollout

---

## 📝 Documentation

### User Documentation

- How to use annotation tools
- Keyboard shortcuts reference
- Tips for effective annotations

### Developer Documentation

- Annotation data format
- Integration guide
- API reference

---

## 🎯 Success Metrics

1. **Adoption**
   - % of captures with annotations
   - Average annotations per capture

2. **Usage**
   - Most used tools
   - Average annotation time

3. **Quality**
   - Error rate (failed annotations)
   - Performance metrics (fps, latency)

---

## 🔄 Future Enhancements

1. **Advanced Tools**
   - Blur tool (privacy)
   - Crop tool
   - Stamps/stickers

2. **Collaboration**
   - Share annotations
   - Comment on annotations
   - Team annotation templates

3. **AI Integration**
   - Auto-annotate based on AI suggestions
   - Highlight AI-detected issues
   - Smart annotation suggestions

4. **Export Options**
   - Export as separate annotation layer
   - Export as PDF with annotations
   - Export as video (animated annotations)

---

## 📋 Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create annotation window HTML/CSS
- [ ] Set up canvas drawing
- [ ] Implement pen tool
- [ ] Add color picker
- [ ] Add brush size selector
- [ ] Implement undo/redo
- [ ] Create annotation data model
- [ ] Create annotation manager

### Phase 2: Drawing Tools
- [ ] Highlighter tool
- [ ] Rectangle tool
- [ ] Circle tool
- [ ] Line tool
- [ ] Arrow tool
- [ ] Text tool
- [ ] Toolbar UI
- [ ] Tool selection

### Phase 3: Advanced Features
- [ ] Eraser tool
- [ ] Opacity control
- [ ] Font size selector
- [ ] Clear all functionality
- [ ] Visibility toggle
- [ ] Enhanced color picker
- [ ] Keyboard shortcuts
- [ ] Performance optimization

### Phase 4: Integration
- [ ] Merge annotations with image
- [ ] Integrate with capture flow
- [ ] Integrate with analysis
- [ ] Store annotations
- [ ] Load from history
- [ ] Export functionality

### Phase 5: Testing & Polish
- [ ] Unit tests
- [ ] E2E tests
- [ ] Performance testing
- [ ] Accessibility testing
- [ ] UI polish
- [ ] Error handling
- [ ] Documentation

---

## 🎉 Conclusion

Screenshot annotations will significantly enhance the user experience by allowing users to:
- Highlight specific areas for AI attention
- Add context directly on images
- Create visual notes before analysis

The implementation is straightforward using native Canvas API and integrates cleanly with the existing capture flow. The feature is optional (users can skip), ensuring backward compatibility.

**Estimated Timeline:** 3-5 days  
**Priority:** Medium (Enhancement)  
**Risk:** Low (isolated feature, optional)
