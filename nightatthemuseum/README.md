## Overview

We will focus on two tools for our body-centric interaction design projects:

- [**Google MediaPipe**](https://developers.google.com/edge/mediapipe/solutions/guide): A suite of open-source libraries and tools developed by Google to apply artificial intelligence (AI) and machine learning (ML) techniques in your applications.
- [**ml5.js**](https://ml5js.org): A beginner-friendly library that leverages **MediaPipe** models for ML tasks. Though still very capable, **ml5.js** does not include all of the functionality of **MediaPipe**. Additionally, the examples in the documentation mostly focus on using **p5.js**.

## Setup

_Note: **MediaPipe** applications can be developed in **Python**. However, due to configuration complexities across operating systems and versions, class examples and support will focus on **JavaScript**._

### Google Chrome

As much as I dislike the near-monopoly that [**Google Chrome**](https://www.google.com/chrome/) has over other web browsers, it is currently the only mainstream option that supports certain advanced features, such as Web MIDI and Web Serial, that may be required for your project. As such, you should have a recent version of **Chrome** installed.

### Code Editor

Class examples will be demonstrated using [**Zed**](https://zed.dev/).

You are welcome to use whichever code editor you prefer (such as [**Visual Studio Code**](https://code.visualstudio.com)), as long as you have a way to host web pages or run **JavaScript**.

### Extensions

**Zed** offers a number of extensions that can assist with multiple aspects of development. The only one recommended for this class is **LiveServer**. Install it using the **Extensions** panel.

### Node.js

[**Node.js**](https://nodejs.org/en) is a **JavaScript** runtime that allows you to run scripts outside of a web browser. For us, the main benefit of this is the ability to interface with additional hardware and communication protocols, such as **OSC** or basic operating system functions. While your projects may not require these features, it is recommended to install **Node.js** now.

### Ollama

Installing a host application to serve LLMs locally has multiple benefits:

- Data privacy (your data is never sent to any cloud servers)
- Energy efficiency and awareness (smaller specialized models can do more with fewer resources)
- Context (local models can reference the code in your file during troubleshooting)

Follow [these instructions](https://docs.google.com/document/d/1iRAMGNryvLlIWCgpHt4Gagth7u-R2VV56EAZ4oBQn5I/edit?usp=sharing) to install and configure **Ollama** with **Zed**.

---

## Examples

There are working examples for both **MediaPipe** and **ml5.js** in this folder. They are just intended to get you started with all of the necessary imports and setup. What you do with the data is up to you!

## MediaPipe Example

The **MediaPipe** example _does not_ provide an overlay on the video to visualize landmarks. Instead, it reads a selection of values from the results and displays them as text in the browser.

Additionally, due to some issues with the **LiveServer** extension in **Zed**, you will need to launch this example either using the **LiveServer** extension in **VS Code** or using the built-in **Python** web server in **Zed**.

### ml5.js Example

The **ml5.js** example provides an overlay on the video to visualize all face and hand landmarks. 

To run the **ml5.js** example from within **Zed**:
- Open the `index.html` file
- Press **command .** (macOS) or **control .** (Windows) to bring up **Code Actions**. You will likely only see "Open in Browser."
- Select "Open in Browser" to launch the page in your default browser.
