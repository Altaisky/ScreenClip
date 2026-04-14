using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ScreenClipClipboardHelper
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern uint GetClipboardSequenceNumber();

        static readonly object clipboardLock = new object();

        [STAThread] // ВАЖНО: Clipboard API требует STA-поток!
        static void Main(string[] args)
        {
            // Сообщаем о готовности в stderr
            Console.Error.WriteLine("ready");

            // Создаём невидимое окно для работы с буфером обмена
            using (var form = new Form())
            {
                form.Opacity = 0;
                form.ShowInTaskbar = false;
                form.FormBorderStyle = FormBorderStyle.None;
                form.WindowState = FormWindowState.Minimized;

                // Читаем команды из stdin
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line))
                        continue;

                    try
                    {
                        string[] parts = line.Split(new[] { ' ' }, 2);
                        string command = parts[0].ToLowerInvariant();

                        switch (command)
                        {
                            case "seq":
                                HandleSequence();
                                break;

                            case "copy":
                                if (parts.Length > 1)
                                    HandleCopy(parts[1].Trim());
                                else
                                    Console.WriteLine("ERROR: No file path provided");
                                break;

                            case "clear":
                                HandleClear();
                                break;

                            default:
                                Console.WriteLine("ERROR: Unknown command: " + command);
                                break;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("ERROR: " + ex.Message);
                    }

                    Console.Out.Flush();
                }
            }
        }

        static void HandleSequence()
        {
            lock (clipboardLock)
            {
                uint seq = GetClipboardSequenceNumber();
                Console.WriteLine(seq.ToString());
            }
        }

        static void HandleCopy(string filePath)
        {
            lock (clipboardLock)
            {
                filePath = filePath.Trim('"', '\'', '^');

                // Ждём, пока Node.js отпустит файл (рейс кондишн в Windows)
                for (int i = 0; i < 5; i++)
                {
                    if (File.Exists(filePath)) break;
                    Thread.Sleep(50);
                }

                try
                {
                    byte[] fileBytes = null;
                    // Пытаемся прочитать файл с повторами
                    for (int i = 0; i < 5; i++)
                    {
                        try
                        {
                            fileBytes = File.ReadAllBytes(filePath);
                            break;
                        }
                        catch (IOException)
                        {
                            Thread.Sleep(100); // Ждём разблокировки
                        }
                    }

                    if (fileBytes != null)
                    {
                        ProcessImageBytes(fileBytes);
                    }
                    else
                    {
                        Console.WriteLine("ERROR: Could not read file after retries");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("ERROR: " + ex.Message);
                }
            }
        }

        static void ProcessImageBytes(byte[] imageBytes)
        {
            try
            {
                using (MemoryStream ms = new MemoryStream(imageBytes))
                using (Image image = Image.FromStream(ms))
                {
                    Bitmap clipboardImage = new Bitmap(image);

                    try
                    {
                        Clipboard.SetImage(clipboardImage);
                        Console.WriteLine("OK");
                    }
                    catch (ExternalException ex)
                    {
                        Console.WriteLine("ERROR: Clipboard access failed: " + ex.Message);
                        clipboardImage.Dispose();
                        return;
                    }

                    clipboardImage.Dispose();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR: " + ex.Message);
            }
        }

        static void HandleClear()
        {
            lock (clipboardLock)
            {
                try
                {
                    Clipboard.Clear();
                    Console.WriteLine("OK");
                }
                catch (ExternalException ex)
                {
                    Console.WriteLine("ERROR: Clipboard clear failed: " + ex.Message);
                }
            }
        }
    }
}
