# GPT-4 Auto Selector

Author: drews5

## Description

Automatically select GPT-4 as the model for ChatGPT on https://chat.openai.com/.

This Chrome extension automatically selects the GPT-4 model when using ChatGPT on https://chat.openai.com/.

## Installation

Follow these steps to manually install the extension in Google Chrome:

1. Download the extension files by clicking on the green "Code" button on the repository page and selecting "Download ZIP". Alternatively, you can use this [link](https://github.com/drews5/chrome-extension-gpt4/archive/refs/heads/main.zip).
2. Extract the downloaded .zip file to a folder of your choice.
3. Open Google Chrome and navigate to the `chrome://extensions` page.
4. Enable "Developer mode" by toggling the switch in the top-right corner of the page.
5. Click on the "Load unpacked" button and select the folder containing the extracted extension files.
6. The extension should now be installed and visible in the list of installed extensions.

## Usage

After installing the extension, simply visit https://chat.openai.com/, and the extension will automatically redirect you to https://chat.openai.com/?model=gpt-4.

Please note that this extension only changes the URL and does not interact with the website itself. The website may still need to implement support for selecting the model based on the URL parameter.

## License

This project is released under the MIT License. For more information, please refer to the [LICENSE](LICENSE) file.
